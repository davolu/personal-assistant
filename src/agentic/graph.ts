import { randomUUID } from "node:crypto";
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { composeReply, screenOutput, wrapUntrusted } from "@/assistant/filters";
import type { TraceEntry } from "@/assistant/types";
import { actionDigest } from "@/assistant/approvals";
import { parseAskInput, type AskPrompt } from "./ask";
import { approachKey, overApproachBudget, readBudgets, rememberApproach, type Budgets } from "./budgets";
import { compactMessages, fallbackSummary, messageChars, type MemoryStore } from "./memory";
import { systemPrompt } from "./prompts";
import { TOOL_SCHEMAS, executionHolds, type ToolRuntime } from "./tools";
import type { ClaudeDriver } from "./claude";
import type {
  AgenticEvent,
  AgenticMessage,
  ComputerCheckpoint,
  ComputerRunResult,
  ConnectLink,
  ContentBlock,
  FailureEntry,
  HintLabel,
  Pending,
  RouteName,
  TodoItem,
  ToolResult,
  ToolUseBlock,
  TraceStep,
  VerifyReport,
} from "./types";

const GraphState = Annotation.Root({
  messages: Annotation<AgenticMessage[]>({ reducer: (_left, right) => right, default: () => [] }),
  userId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  goal: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  threadId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  todos: Annotation<TodoItem[]>({ reducer: (_a, b) => b, default: () => [] }),
  trace: Annotation<TraceStep[]>({ reducer: (_left, right) => right, default: () => [] }),
  ledger: Annotation<FailureEntry[]>({ reducer: (_left, right) => right, default: () => [] }),
  toolCalls: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  approaches: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  connectLinks: Annotation<ConnectLink[]>({ reducer: (_a, b) => b, default: () => [] }),
  pending: Annotation<Pending | null>({ reducer: (_a, b) => b, default: () => null }),
  finalAnswer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyScore: Annotation<number | null>({ reducer: (_a, b) => b, default: () => null }),
  verifyLabel: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyFeedback: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyRetries: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  ungrounded: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  status: Annotation<string>({ reducer: (_a, b) => b, default: () => "running" }),
  route: Annotation<RouteName>({ reducer: (_a, b) => b, default: () => "agent" }),
  startedAt: Annotation<number>({ reducer: (left, right) => (left ? left : right), default: () => 0 }),
  computerStream: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  sandboxId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
});

export type AgenticState = typeof GraphState.State;

export interface Critic {
  score(input: { request: string; answer: string; trace: TraceStep[] }): Promise<VerifyReport>;
  hint(input: { request: string; tool: string; result: string }): Promise<HintLabel>;
}

export interface ComputerRunner {
  run(input: {
    userId: string;
    task: string;
    checkpoint?: ComputerCheckpoint;
    resume?: Pending["resume"];
  }): Promise<ComputerRunResult>;
}

export interface EffectLedger {
  get(userId: string, key: string): Promise<string | null>;
  put(userId: string, key: string, result: string): Promise<void>;
}

export type AgenticDeps = {
  budgets: Budgets;
  claude: ClaudeDriver;
  critic: Critic;
  tools: ToolRuntime;
  memory: MemoryStore;
  computer: ComputerRunner;
  ledger: EffectLedger;
  summarize: (messages: AgenticMessage[]) => Promise<string>;
  onEvent?: (event: AgenticEvent) => void;
  now: () => number;
};

export function compileAgenticGraph(deps: AgenticDeps, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  const graph = new StateGraph(GraphState)
    .addNode("agent", (state) => agentNode(state, deps))
    .addNode("tools", (state) => toolsNode(state, deps))
    .addNode("verify", (state) => verifyNode(state, deps))
    .addNode("ask", (state) => askNode(state))
    .addNode("approve", (state) => approveNode(state, deps))
    .addNode("connect", (state) => connectNode(state))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => (state.route === "tools" ? "tools" : state.route === "ask" ? "ask" : "verify"))
    .addConditionalEdges("tools", (state) => {
      if (state.route === "ask") return "ask";
      if (state.route === "approve") return "approve";
      if (state.route === "connect") return "connect";
      return "agent";
    })
    .addConditionalEdges("ask", (state) => (state.route === "tools" ? "tools" : "agent"))
    .addConditionalEdges("approve", (state) => (state.route === "tools" ? "tools" : "agent"))
    .addEdge("connect", "agent")
    .addConditionalEdges("verify", (state) => (state.route === "agent" ? "agent" : END));
  return graph.compile({ checkpointer });
}

export function threadConfig(threadId: string) {
  return { configurable: { thread_id: threadId }, recursionLimit: 120 };
}

export function readInterrupt(result: unknown): unknown {
  const record = result as { __interrupt__?: { value: unknown }[] };
  return record.__interrupt__?.[0]?.value ?? null;
}

export { Command, GraphState };

async function agentNode(state: AgenticState, deps: AgenticDeps) {
  let messages = state.messages;
  if (messageChars(messages) > deps.budgets.compactChars) {
    const summary = await deps.summarize(messages).catch(() => fallbackSummary(messages));
    messages = compactMessages(messages, summary);
    deps.onEvent?.({ type: "thinking", text: "Compacted earlier turns so the conversation can continue." });
  }
  const limit = budgetReason(state, deps);
  if (limit) return forceAsk(messages, state, limit, deps);

  const memory = await deps.memory.recall(state.userId, state.goal).catch(() => ({ facts: [], episodes: [] }));
  let turn;
  try {
    turn = await deps.claude.complete({
      system: systemPrompt({
        budgets: deps.budgets,
        facts: memory.facts,
        episodes: memory.episodes,
        todos: state.todos,
        failures: state.ledger,
        connects: state.connectLinks,
      }),
      messages,
      tools: TOOL_SCHEMAS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The model is unavailable.";
    return {
      messages,
      finalAnswer: message,
      route: "verify" as const,
      status: "running",
    };
  }
  if (turn.thinkingSummary) deps.onEvent?.({ type: "thinking", text: turn.thinkingSummary });
  const nextMessages: AgenticMessage[] = [...messages, { role: "assistant", content: turn.content }];
  const calls = toolUses(turn.content);
  if (calls.length === 0) {
    const text = textOf(turn.content);
    deps.onEvent?.({ type: "token", text });
    return { messages: nextMessages, finalAnswer: text, route: "verify" as const, status: "running" };
  }
  for (const call of calls) deps.onEvent?.({ type: "tool", name: call.name, status: "start", summary: summarizeInput(call.input) });
  return { messages: nextMessages, route: "tools" as const, status: "running", toolCalls: state.toolCalls + calls.length };
}

async function toolsNode(state: AgenticState, deps: AgenticDeps) {
  if (state.pending?.phase === "resume-computer" && state.pending.computer) return continueComputer(state, deps);
  const calls = toolUses(Array.isArray(state.messages.at(-1)?.content) ? (state.messages.at(-1)?.content as ContentBlock[]) : []);
  const results: ToolResult[] = [];
  let approaches = state.approaches;
  let todos = state.todos;
  let connectLinks = state.connectLinks;
  let computerStream = state.computerStream;
  let sandboxId = state.sandboxId;
  const trace: TraceStep[] = [];
  const ledger: FailureEntry[] = [];
  let pause: Pending | null = null;

  for (const call of calls) {
    if (pause) {
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Not run because this turn is waiting on you. Call it again if you still need it." });
      continue;
    }
    const repeated = state.ledger.find((entry) => approachKey(entry.tool, entry.args) === approachKey(call.name, call.input) && canonical(entry.args) === canonical(call.input));
    if (call.name === "ask_user") {
      pause = askPending(call, results, calls);
      emitAsk(deps, pause);
      continue;
    }
    if (call.name === "update_todo") {
      todos = normalizeTodos(call.input);
      results.push(ok(call.id, "Todo list updated."));
      deps.onEvent?.({ type: "todo", items: todos });
      deps.onEvent?.({ type: "tool", name: call.name, status: "ok", summary: `${todos.length} items` });
      continue;
    }
    if (repeated) {
      const note = `You already tried this. Previous result: ${repeated.outcome}. Change approach.`;
      results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: note });
      deps.onEvent?.({ type: "tool", name: call.name, status: "error", summary: "Repeated call. Change approach." });
      continue;
    }
    const handled = await dispatch(call, state, deps, { approaches, connectLinks, computerStream, sandboxId, todos });
    approaches = handled.approaches;
    connectLinks = handled.connectLinks;
    computerStream = handled.computerStream;
    sandboxId = handled.sandboxId;
    todos = handled.todos;
    trace.push(...handled.trace);
    ledger.push(...handled.ledger);
    if (handled.pause) {
      pause = { ...handled.pause, siblingResults: results, order: calls.map((item) => item.id) };
      continue;
    }
    results.push(handled.result);
  }

  if (pause) {
    return {
      pending: pause,
      route: pause.kind === "ask" ? "ask" : pause.kind === "approval" ? "approve" : "connect",
      approaches,
      connectLinks,
      computerStream,
      sandboxId,
      todos,
      trace: [...state.trace, ...trace],
      ledger: [...state.ledger, ...ledger],
      status: pause.kind === "ask" ? "ask_user" : pause.kind,
    } as const;
  }

  await attachHints(results, state.goal, deps);
  if (overApproachBudget(approaches, deps.budgets)) {
    return askAboutApproaches(state, results, calls, approaches, { connectLinks, computerStream, sandboxId, todos, trace, ledger }, deps);
  }
  return {
    messages: [...state.messages, { role: "user" as const, content: orderResults(calls.map((call) => call.id), results) }],
    pending: null,
    route: "agent" as const,
    approaches,
    connectLinks,
    computerStream,
    sandboxId,
    todos,
    trace: [...state.trace, ...trace],
    ledger: [...state.ledger, ...ledger],
    status: "running",
  };
}

async function verifyNode(state: AgenticState, deps: AgenticDeps) {
  const claimTrace = state.trace.map(toTraceEntry);
  const report = await deps.critic.score({ request: state.goal, answer: state.finalAnswer, trace: state.trace }).catch(() => ({
    score: 1,
    label: "meets" as const,
    ungrounded: false,
    feedback: "Verifier unavailable.",
  }));
  const falseClaim = composeReply(state.finalAnswer, claimTrace) !== state.finalAnswer.trim();
  const fails = report.label === "fails" || report.ungrounded || falseClaim;
  if (fails && state.verifyRetries < 1) {
    const feedback = report.ungrounded || falseClaim ? "The answer claims an action the tool trace does not show. Revise it and do not claim a send, delete, or payment that did not succeed." : report.feedback;
    deps.onEvent?.({ type: "verify", score: report.score, label: report.label, ungrounded: report.ungrounded || falseClaim, feedback });
    return {
      messages: [...state.messages, { role: "user" as const, content: `Verifier: ${feedback}` }],
      finalAnswer: "",
      verifyScore: report.score,
      verifyLabel: report.label,
      verifyFeedback: feedback,
      verifyRetries: state.verifyRetries + 1,
      ungrounded: report.ungrounded || falseClaim,
      route: "agent" as const,
      status: "running",
    };
  }
  const safe = screenOutput(composeReply(state.finalAnswer, claimTrace)).text;
  deps.onEvent?.({ type: "verify", score: report.score, label: report.label, ungrounded: report.ungrounded, feedback: report.feedback });
  const lesson = `Tools: ${state.trace.map((step) => step.tool).join(", ") || "none"}.`;
  await deps.memory
    .addEpisode(state.userId, { threadId: state.threadId, summary: safe.slice(0, 500), lesson })
    .catch(() => undefined);
  return {
    finalAnswer: safe,
    verifyScore: report.score,
    verifyLabel: report.label,
    verifyFeedback: report.feedback,
    ungrounded: report.ungrounded,
    route: "end" as const,
    status: "done",
  };
}

function askNode(state: AgenticState) {
  const pending = state.pending;
  if (!pending || pending.kind !== "ask") return { route: "agent" as const, pending: null };
  const answer = interrupt({
    kind: "ask",
    question: pending.question ?? "",
    choices: pending.choices ?? [],
    options: pending.options ?? [],
    multiSelect: pending.multiSelect === true,
    allowCustom: pending.allowCustom === true,
    streamUrl: state.computerStream || undefined,
  });
  const text = resumeText(answer);
  if (pending.computer) {
    return {
      pending: { ...pending, phase: "resume-computer" as const, resume: { kind: "ask" as const, text } },
      route: "tools" as const,
      status: "running",
    };
  }
  return finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content: text || "(no answer)" });
}

async function approveNode(state: AgenticState, deps: AgenticDeps) {
  const pending = state.pending;
  if (!pending || pending.kind !== "approval") return { route: "agent" as const, pending: null };
  const decision = interrupt({
    kind: "approval",
    tool: pending.tool ?? "execute_tools",
    args: pending.args ?? {},
    summary: pending.summary ?? "Approve this action?",
    digest: pending.digest ?? "",
  });
  const parsed = resumeDecision(decision);
  if (pending.computer) {
    return {
      pending: { ...pending, phase: "resume-computer" as const, resume: { kind: "approval" as const, decision: parsed.decision, text: parsed.text, args: parsed.args } },
      route: "tools" as const,
      status: "running",
    };
  }
  if (parsed.decision === "reject") {
    return finishPause(
      state,
      pending,
      { type: "tool_result", tool_use_id: pending.toolUseId, is_error: true, content: "The user rejected this action. Nothing was sent, deleted, or paid. Offer to edit it." },
      [{ tool: pending.tool ?? "execute_tools", args: pending.args ?? {}, ok: false, effect: "external", denied: true, error: "rejected" }]
    );
  }
  const args = parsed.decision === "edit" && parsed.args ? parsed.args : pending.args ?? {};
  const key = actionDigest(pending.tool ?? "execute_tools", args);
  const cached = await deps.ledger.get(state.userId, key);
  let content = cached ?? "";
  let isError = false;
  if (!cached) {
    const outcome = await deps.tools.executeTools(state.userId, args);
    content = outcome.isError ? outcome.content : wrapUntrusted("execute_tools", outcome.content);
    isError = outcome.isError;
    if (!outcome.isError) await deps.ledger.put(state.userId, key, outcome.content);
  }
  return finishPause(
    state,
    pending,
    { type: "tool_result", tool_use_id: pending.toolUseId, content, is_error: isError },
    [{ tool: pending.tool ?? "execute_tools", args, ok: !isError, effect: "external", error: isError ? content.slice(0, 200) : undefined }]
  );
}

function connectNode(state: AgenticState) {
  const pending = state.pending;
  if (!pending || pending.kind !== "connect") return { route: "agent" as const, pending: null };
  const answer = interrupt({ kind: "connect", app: pending.app ?? "", url: pending.url ?? "", question: pending.question ?? `Connect ${pending.app}?` });
  const record = answer && typeof answer === "object" ? (answer as { connected?: boolean; declined?: boolean; text?: string }) : {};
  const declined = record.declined === true || record.connected === false;
  const content = declined
    ? `The user declined to connect ${pending.app}. Offer an alternative such as notes or text they can paste. Do not send the same connect link again.`
    : `The user connected ${pending.app}. Continue the original task without asking them to restate it.`;
  return finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content });
}

async function continueComputer(state: AgenticState, deps: AgenticDeps) {
  const pending = state.pending;
  if (!pending?.computer) return { route: "agent" as const, pending: null };
  const result = await deps.computer.run({
    userId: state.userId,
    task: pending.computer.task,
    checkpoint: pending.computer,
    resume: pending.resume,
  });
  return computerOutcome(state, pending, result, deps);
}

async function dispatch(
  call: ToolUseBlock,
  state: AgenticState,
  deps: AgenticDeps,
  bag: { approaches: string[]; connectLinks: ConnectLink[]; computerStream: string; sandboxId: string; todos: TodoItem[] }
) {
  const base = { ...bag, trace: [] as TraceStep[], ledger: [] as FailureEntry[], pause: null as Pending | null, result: ok(call.id, "") };
  try {
    if (call.name === "remember") {
      const text = String(call.input.text ?? "").trim();
      if (!text) return fail(base, call, "text is required");
      await deps.memory.addFact(state.userId, text);
      base.result = ok(call.id, `Remembered: ${text}`);
      base.trace.push({ tool: "remember", args: { text }, ok: true, effect: "write_internal" });
      note(deps, call, "ok", "Saved a fact");
      return base;
    }
    if (call.name === "recall") {
      const query = String(call.input.query ?? state.goal);
      const found = await deps.memory.recall(state.userId, query);
      const content = [`Facts: ${found.facts.join(" | ") || "none"}`, `Episodes: ${found.episodes.join(" | ") || "none"}`].join("\n");
      base.result = ok(call.id, wrapUntrusted("recall", content));
      base.trace.push({ tool: "recall", args: { query }, ok: true, effect: "read" });
      note(deps, call, "ok", content.slice(0, 120));
      return base;
    }
    if (call.name === "web_search") {
      const outcome = await deps.tools.webSearch(state.userId, String(call.input.query ?? ""));
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "research") {
      const outcome = await deps.tools.research(state.userId, String(call.input.goal ?? state.goal));
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "search_tools") {
      const outcome = await deps.tools.searchTools(state.userId, call.input);
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "connect_app") {
      const outcome = await deps.tools.connectApp(state.userId, call.input);
      if (outcome.connect) {
        base.connectLinks = mergeLinks(base.connectLinks, outcome.connect);
        deps.onEvent?.({ type: "connect", app: outcome.connect.app, url: outcome.connect.url });
        base.pause = {
          kind: "connect",
          toolUseId: call.id,
          app: outcome.connect.app,
          url: outcome.connect.url,
          question: `Connect ${outcome.connect.app} to continue.`,
          siblingResults: [],
          order: [],
        };
        note(deps, call, "ok", `Connect ${outcome.connect.app}`);
        return base;
      }
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "execute_tools") {
      const gate = executionHolds(call.input);
      if (gate.unknown.length && !gate.hold) {
        return fail(base, call, `Unknown or disallowed tools: ${gate.unknown.join(", ")}. Search again and use a real slug.`);
      }
      if (gate.hold) {
        base.pause = {
          kind: "approval",
          toolUseId: call.id,
          tool: "execute_tools",
          args: call.input,
          summary: approvalSummary(call.input),
          digest: actionDigest("execute_tools", call.input),
          siblingResults: [],
          order: [],
        };
        deps.onEvent?.({ type: "approval", tool: "execute_tools", args: call.input, summary: base.pause.summary ?? "" });
        base.trace.push({ tool: "execute_tools", args: call.input, ok: false, effect: "external", queued: true });
        return base;
      }
      const outcome = await deps.tools.executeTools(state.userId, call.input);
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "use_computer") {
      const task = String(call.input.task ?? "");
      const result = await deps.computer.run({ userId: state.userId, task });
      if (result.streamUrl) {
        base.computerStream = result.streamUrl;
        base.sandboxId = result.sandboxId ?? base.sandboxId;
        deps.onEvent?.({ type: "computer", streamUrl: result.streamUrl, sandboxId: result.sandboxId ?? "" });
      }
      if (result.status === "ask" || result.status === "approval") {
        base.pause = computerPause(call.id, result);
        if (result.status === "ask") emitAsk(deps, result);
        else deps.onEvent?.({ type: "approval", tool: "use_computer", args: result.action, summary: result.summary });
        return base;
      }
      if (result.status === "error") return fail(base, call, result.message);
      base.result = ok(call.id, computerText(result));
      base.trace.push({ tool: "use_computer", args: { task }, ok: true, effect: "read" });
      note(deps, call, "ok", result.summary.slice(0, 140));
      return base;
    }
    return fail(base, call, `Unknown tool ${call.name}.`);
  } catch (err) {
    return fail(base, call, err instanceof Error ? err.message : "Tool failed");
  }
}

function computerOutcome(state: AgenticState, pending: Pending, result: ComputerRunResult, deps: AgenticDeps) {
  let computerStream = result.streamUrl || state.computerStream;
  let sandboxId = result.sandboxId || state.sandboxId;
  if (result.streamUrl) deps.onEvent?.({ type: "computer", streamUrl: result.streamUrl, sandboxId: sandboxId });
  if (result.status === "ask" || result.status === "approval") {
    const next: Pending = {
      ...pending,
      phase: undefined,
      resume: undefined,
      kind: result.status === "ask" ? "ask" : "approval",
      question: result.status === "ask" ? result.question : pending.question,
      choices: result.status === "ask" ? result.choices : pending.choices,
      options: result.status === "ask" ? result.options : pending.options,
      multiSelect: result.status === "ask" ? result.multiSelect : pending.multiSelect,
      allowCustom: result.status === "ask" ? result.allowCustom : pending.allowCustom,
      summary: result.status === "approval" ? result.summary : pending.summary,
      args: result.status === "approval" ? result.action : pending.args,
      tool: "use_computer",
      computer: result.checkpoint,
    };
    if (result.status === "ask") emitAsk(deps, result);
    else deps.onEvent?.({ type: "approval", tool: "use_computer", args: result.action, summary: result.summary });
    return { pending: next, route: result.status === "ask" ? ("ask" as const) : ("approve" as const), computerStream, sandboxId, status: result.status === "ask" ? "ask_user" : "approval" };
  }
  const isError = result.status === "error";
  const content = isError ? result.message : computerText(result);
  const approaches = isError ? rememberApproach(state.approaches, approachKey("use_computer", { task: pending.computer?.task ?? "" })) : state.approaches;
  if (isError) deps.onEvent?.({ type: "tool", name: "use_computer", status: "error", summary: result.message.slice(0, 140) });
  else deps.onEvent?.({ type: "tool", name: "use_computer", status: "ok", summary: result.summary.slice(0, 140) });
  return {
    ...finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content, is_error: isError }, [
      { tool: "use_computer", args: { task: pending.computer?.task ?? "" }, ok: !isError, effect: "read", error: isError ? content.slice(0, 200) : undefined },
    ]),
    approaches,
    computerStream,
    sandboxId,
    ledger: isError ? [...state.ledger, { tool: "use_computer", args: { task: pending.computer?.task ?? "" }, outcome: content.slice(0, 300) }] : state.ledger,
  };
}

function applyOutcome<T extends { approaches: string[]; result: ToolResult; trace: TraceStep[]; ledger: FailureEntry[] }>(
  base: T,
  call: ToolUseBlock,
  outcome: { content: string; isError: boolean; effect?: TraceStep["effect"] },
  deps: AgenticDeps
): T {
  const content = outcome.isError ? outcome.content : wrapUntrusted(call.name, outcome.content);
  base.result = { type: "tool_result", tool_use_id: call.id, content, is_error: outcome.isError };
  base.trace.push({ tool: call.name, args: call.input, ok: !outcome.isError, effect: outcome.effect ?? "read", error: outcome.isError ? outcome.content.slice(0, 200) : undefined });
  if (outcome.isError) {
    base.approaches = rememberApproach(base.approaches, approachKey(call.name, call.input));
    base.ledger.push({ tool: call.name, args: call.input, outcome: outcome.content.slice(0, 300) });
  }
  note(deps, call, outcome.isError ? "error" : "ok", outcome.content.slice(0, 140));
  return base;
}

function fail<T extends { approaches: string[]; result: ToolResult; trace: TraceStep[]; ledger: FailureEntry[] }>(base: T, call: ToolUseBlock, message: string): T {
  base.result = { type: "tool_result", tool_use_id: call.id, content: message, is_error: true };
  base.approaches = rememberApproach(base.approaches, approachKey(call.name, call.input));
  base.ledger.push({ tool: call.name, args: call.input, outcome: message.slice(0, 300) });
  base.trace.push({ tool: call.name, args: call.input, ok: false, effect: "read", error: message.slice(0, 200) });
  return base;
}

function finishPause(state: AgenticState, pending: Pending, result: ToolResult, trace: TraceStep[] = []) {
  const ordered = orderResults(pending.order.length ? pending.order : [pending.toolUseId], pending.siblingResults, result);
  return {
    messages: [...state.messages, { role: "user" as const, content: ordered }],
    pending: null,
    route: "agent" as const,
    status: "running",
    trace: [...state.trace, ...trace],
  };
}

function askAboutApproaches(
  state: AgenticState,
  results: ToolResult[],
  calls: ToolUseBlock[],
  approaches: string[],
  extra: { connectLinks: ConnectLink[]; computerStream: string; sandboxId: string; todos: TodoItem[]; trace: TraceStep[]; ledger: FailureEntry[] },
  deps: AgenticDeps
) {
  const id = `ask-${randomUUID()}`;
  const ask = parseAskInput({ question: `I tried ${approaches.length} approaches (${approaches.join("; ")}) and they did not finish the task. What should I do next?`, allowCustom: true });
  emitAsk(deps, ask);
  const messages: AgenticMessage[] = [
    ...state.messages,
    { role: "user", content: orderResults(calls.map((call) => call.id), results) },
    { role: "assistant", content: [{ type: "text", text: ask.question }, { type: "tool_use", id, name: "ask_user", input: { question: ask.question, allowCustom: true } }] },
  ];
  return {
    messages,
    approaches,
    connectLinks: extra.connectLinks,
    computerStream: extra.computerStream,
    sandboxId: extra.sandboxId,
    todos: extra.todos,
    trace: [...state.trace, ...extra.trace],
    ledger: [...state.ledger, ...extra.ledger],
    pending: { kind: "ask" as const, toolUseId: id, ...askFields(ask), siblingResults: [], order: [id] },
    route: "ask" as const,
    status: "ask_user",
    toolCalls: state.toolCalls + 1,
  };
}

function forceAsk(messages: AgenticMessage[], state: AgenticState, reason: string, deps: AgenticDeps) {
  const id = `ask-${randomUUID()}`;
  const ask = parseAskInput({ question: `${reason} How should I continue?`, allowCustom: true });
  emitAsk(deps, ask);
  return {
    messages: [
      ...messages,
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: ask.question },
          { type: "tool_use" as const, id, name: "ask_user", input: { question: ask.question, allowCustom: true } },
        ],
      },
    ],
    pending: { kind: "ask" as const, toolUseId: id, ...askFields(ask), siblingResults: [], order: [id] },
    route: "ask" as const,
    status: "ask_user",
    toolCalls: state.toolCalls + 1,
  };
}

function budgetReason(state: AgenticState, deps: AgenticDeps): string | null {
  if (state.toolCalls >= deps.budgets.maxToolCalls) return `I used ${state.toolCalls} tool calls, which is the budget for this turn.`;
  if (state.startedAt && deps.now() - state.startedAt > deps.budgets.wallClockMs) return "This turn reached its active time budget.";
  return null;
}

function askPending(call: ToolUseBlock, results: ToolResult[], calls: ToolUseBlock[]): Pending {
  return {
    kind: "ask",
    toolUseId: call.id,
    ...askFields(parseAskInput(call.input)),
    siblingResults: results,
    order: calls.map((item) => item.id),
  };
}

function askFields(ask: AskPrompt) {
  return {
    question: ask.question,
    choices: ask.choices,
    options: ask.options,
    multiSelect: ask.multiSelect,
    allowCustom: ask.allowCustom,
  };
}

function emitAsk(deps: AgenticDeps, source: { question?: string; choices?: string[]; options?: AskPrompt["options"]; multiSelect?: boolean; allowCustom?: boolean }) {
  const ask = parseAskInput(source);
  deps.onEvent?.({ type: "ask", ...askFields(ask) });
}

function computerPause(toolUseId: string, result: Extract<ComputerRunResult, { status: "ask" | "approval" }>): Pending {
  if (result.status === "ask") {
    return {
      kind: "ask",
      toolUseId,
      ...askFields(parseAskInput(result)),
      computer: result.checkpoint,
      siblingResults: [],
      order: [],
    };
  }
  return {
    kind: "approval",
    toolUseId,
    tool: "use_computer",
    args: result.action,
    summary: result.summary,
    digest: actionDigest("use_computer", result.action),
    computer: result.checkpoint,
    siblingResults: [],
    order: [],
  };
}

async function attachHints(results: ToolResult[], request: string, deps: AgenticDeps) {
  for (const result of results) {
    const text = typeof result.content === "string" ? result.content : "";
    if (!text) continue;
    const hint = await deps.critic.hint({ request, tool: result.tool_use_id, result: text }).catch(() => "unsure" as const);
    if (hint && hint !== "unsure") result.content = `${text}\n\nCritic hint: ${hint}. Ignore this if it does not help.`;
  }
}

function orderResults(order: string[], results: ToolResult[], extra?: ToolResult): ToolResult[] {
  const byId = new Map(results.map((result) => [result.tool_use_id, result]));
  if (extra) byId.set(extra.tool_use_id, extra);
  const ids = order.length ? order : [...byId.keys()];
  return ids.map(
    (id) => byId.get(id) ?? { type: "tool_result" as const, tool_use_id: id, is_error: true, content: "Not run." }
  );
}

function toolUses(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function ok(id: string, content: string): ToolResult {
  return { type: "tool_result", tool_use_id: id, content };
}

function note(deps: AgenticDeps, call: ToolUseBlock, status: "ok" | "error", summary: string) {
  deps.onEvent?.({ type: "tool", name: call.name, status, summary });
}

function normalizeTodos(input: Record<string, unknown>): TodoItem[] {
  const items = Array.isArray(input.items) ? input.items : [];
  return items.slice(0, 20).map((item, index) => {
    const record = item && typeof item === "object" ? (item as { id?: string; title?: string; status?: string }) : {};
    const status = record.status === "done" || record.status === "in_progress" ? record.status : "pending";
    return { id: String(record.id ?? `todo-${index + 1}`), title: String(record.title ?? "Task").slice(0, 160), status };
  });
}

function mergeLinks(current: ConnectLink[], link: ConnectLink): ConnectLink[] {
  return [...current.filter((item) => item.url !== link.url), link];
}

function approvalSummary(args: Record<string, unknown>): string {
  const tools = Array.isArray(args.tools) ? args.tools : [];
  const slugs = tools.map((item) => String((item as { tool_slug?: string }).tool_slug ?? "")).filter(Boolean);
  return `Approve ${slugs.join(", ") || "this action"}? Nothing is sent until you approve.`;
}

function computerText(result: Extract<ComputerRunResult, { status: "done" }>): string {
  const shot = result.screenshot ? " A final screenshot was captured." : "";
  const stream = result.streamUrl ? ` Live desktop: ${result.streamUrl}` : "";
  return `${result.summary}${shot}${stream}`;
}

function resumeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "");
  return "";
}

function resumeDecision(value: unknown): { decision: "approve" | "reject" | "edit"; text?: string; args?: Record<string, unknown> } {
  if (!value || typeof value !== "object") return { decision: "reject" };
  const record = value as { decision?: string; text?: string; args?: Record<string, unknown> };
  if (record.decision === "approve" || record.decision === "edit") return { decision: record.decision, text: record.text, args: record.args };
  return { decision: "reject", text: record.text };
}

function toTraceEntry(step: TraceStep): TraceEntry {
  return {
    tool: step.tool,
    args: step.args,
    effect: step.effect === "unknown" ? "unknown" : step.effect,
    ok: step.ok,
    ...(step.queued ? { queued: true } : {}),
    ...(step.denied ? { denied: true } : {}),
    ...(step.error ? { error: step.error } : {}),
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function summarizeInput(input: Record<string, unknown>): string {
  const text = String(input.query ?? input.task ?? input.goal ?? input.question ?? input.toolkit ?? "");
  if (text) return text.slice(0, 140);
  return JSON.stringify(input).slice(0, 140);
}

export function defaultDeps(overrides: Partial<AgenticDeps> = {}): AgenticDeps {
  return {
    budgets: readBudgets(),
    claude: { async complete() { return { content: [{ type: "text", text: "Hello." }], thinkingSummary: "" }; } },
    critic: {
      async score() {
        return { score: 1, label: "meets", ungrounded: false, feedback: "ok" };
      },
      async hint() {
        return "unsure";
      },
    },
    tools: {
      async searchTools() { return { content: "No tools configured.", isError: true }; },
      async connectApp() { return { content: "Connect is not configured.", isError: true }; },
      async executeTools() { return { content: "Execute is not configured.", isError: true }; },
      async webSearch() { return { content: "Web search is not configured.", isError: true }; },
      async research() { return { content: "Research is not configured.", isError: true }; },
    },
    memory: { async addFact() {}, async recall() { return { facts: [], episodes: [] }; }, async addEpisode() {} },
    computer: { async run() { return { status: "error", message: "Desktop is not configured." }; } },
    ledger: { async get() { return null; }, async put() {} },
    summarize: async (messages) => fallbackSummary(messages),
    now: () => Date.now(),
    ...overrides,
  };
}
