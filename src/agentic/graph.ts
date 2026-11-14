import { randomUUID } from "node:crypto";
import { Annotation, Command, END, MemorySaver, START, StateGraph, interrupt } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { composeReply, screenOutput, wrapUntrusted } from "@/assistant/filters";
import type { TraceEntry } from "@/assistant/types";
import { actionDigest } from "@/assistant/approvals";
import { parseAskInput, type AskPrompt } from "./ask";
import {
  HOLD_UPDATE_PREFIX,
  holdFromPending,
  isDefer,
  normalizeResolution,
  placeOpenHolds,
  publicError,
  upsertHold,
  waitingNote,
  type GateResolution,
} from "./holds";
import type { TokenUsage } from "@/lib/credits";
import { computerStatusText, computerToolResult } from "./computer";
import { allowsComputer, selectTools } from "./models";
import {
  activeElapsed,
  approachKey,
  budgetIntentFromModel,
  knownBudgetIntent,
  openActiveClock,
  overApproachBudget,
  pauseActiveClock,
  readBudgets,
  rememberApproach,
  settleActiveClock,
  type BudgetIntent,
  type Budgets,
} from "./budgets";
import { compactMessages, fallbackSummary, messageChars, type MemoryStore } from "./memory";
import { systemPrompt } from "./prompts";
import { scheduleFromToolArgs } from "./schedules";
import { agentToolSchemas, executionHolds, type ToolRuntime } from "./tools";
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
  Hold,
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
  holds: Annotation<Hold[]>({ reducer: (_a, b) => b, default: () => [] }),
  resolution: Annotation<GateResolution | null>({ reducer: (_a, b) => b, default: () => null }),
  finalAnswer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyScore: Annotation<number | null>({ reducer: (_a, b) => b, default: () => null }),
  verifyLabel: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyFeedback: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  verifyRetries: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  ungrounded: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  status: Annotation<string>({ reducer: (_a, b) => b, default: () => "running" }),
  route: Annotation<RouteName>({ reducer: (_a, b) => b, default: () => "agent" }),
  // Last write wins, including 0. Keeping the first timestamp made a resumed
  // turn reuse the original startedAt, so the next step asked the same budget question.
  startedAt: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  activeMs: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  touchedAt: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  computerStream: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  sandboxId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  modelId: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  plan: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  allowExternal: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
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

export type RunGuard = {
  /** Return a message to end the run before another model call. The transcript stays. */
  beforeModel(): Promise<string | null>;
  /** Charge the call that just finished. A message ends the run. */
  afterModel(modelId: string, usage: TokenUsage | undefined): Promise<string | null>;
};

export type AgenticDeps = {
  budgets: Budgets;
  claude: ClaudeDriver;
  guard?: RunGuard;
  critic: Critic;
  tools: ToolRuntime;
  memory: MemoryStore;
  computer: ComputerRunner;
  ledger: EffectLedger;
  schedules: {
    save(input: { userId: string; threadId: string; goal: string; messages: AgenticMessage[]; args: Record<string, unknown> }): Promise<{ ok: boolean; message: string }>;
  };
  summarize: (messages: AgenticMessage[]) => Promise<string>;
  onEvent?: (event: AgenticEvent) => void;
  now: () => number;
};

export function compileAgenticGraph(deps: AgenticDeps, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  const graph = new StateGraph(GraphState)
    .addNode("agent", (state) => agentNode(state, deps))
    .addNode("tools", (state) => toolsNode(state, deps))
    .addNode("verify", (state) => verifyNode(state, deps))
    .addNode("ask", (state) => askNode(state, deps))
    .addNode("approve", (state) => approveNode(state, deps))
    .addNode("connect", (state) => connectNode(state, deps))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => {
      if (state.route === "tools") return "tools";
      if (state.route === "ask") return "ask";
      if (state.route === "end") return END;
      return "verify";
    })
    .addConditionalEdges("tools", (state) => {
      if (state.route === "ask") return "ask";
      if (state.route === "approve") return "approve";
      if (state.route === "connect") return "connect";
      if (state.route === "end") return END;
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
  let working = state;
  let resetBudget = false;
  if (state.resolution) {
    const settled = await applyResolution(state, deps);
    if (settled.route === "end") return { ...settled, touchedAt: deps.now() };
    resetBudget = settled.resetBudget === true;
    const { resetBudget: _drop, ...rest } = settled;
    working = { ...state, ...rest, resolution: null };
  }
  const now = deps.now();
  const clock = resetBudget ? { ...openActiveClock(now, 0), touchedAt: now } : settleActiveClock(working, now);
  working = { ...working, ...clock, ...(resetBudget ? { toolCalls: 0 } : {}) };
  if (resetBudget) deps.onEvent?.({ type: "thinking", text: "Continuing with a fresh time budget." });
  let messages = working.messages;
  let holds = working.holds;
  let trace = working.trace;
  if (messageChars(messages) > deps.budgets.compactChars) {
    const summary = await deps.summarize(messages).catch(() => fallbackSummary(messages));
    messages = compactMessages(messages, summary);
    deps.onEvent?.({ type: "thinking", text: "Compacted earlier turns so the conversation can continue." });
  }
  const limit = budgetReason(working, deps);
  if (limit) return { ...forceAsk(messages, working, limit, deps), ...pauseActiveClock(working, deps.now()), touchedAt: deps.now() };
  const blocked = await deps.guard?.beforeModel();
  if (blocked) return stopForCredits(messages, working, blocked);

  const memory = await deps.memory.recall(working.userId, working.goal).catch(() => ({ facts: [], episodes: [] }));
  let turn;
  try {
    turn = await deps.claude.complete({
      system: systemPrompt({
        budgets: deps.budgets,
        facts: memory.facts,
        episodes: memory.episodes,
        todos: working.todos,
        failures: working.ledger,
        connects: working.connectLinks,
        holds: working.holds,
      }),
      messages,
      tools: toolsForPlan(working.modelId, working.plan),
      modelId: working.modelId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The model is unavailable.";
    return carried(working, deps, {
      messages,
      holds,
      trace,
      resolution: null,
      computerStream: working.computerStream,
      sandboxId: working.sandboxId,
      finalAnswer: message,
      route: "verify" as const,
      status: "running",
    });
  }
  if (turn.thinkingSummary) deps.onEvent?.({ type: "thinking", text: turn.thinkingSummary });
  const charged = await deps.guard?.afterModel(working.modelId, turn.usage);
  const nextMessages: AgenticMessage[] = [...messages, { role: "assistant", content: turn.content }];
  if (charged) return stopForCredits(nextMessages, working, charged);
  holds = placeOpenHolds(holds, nextMessages.length - 1);
  const calls = toolUses(turn.content);
  if (calls.length === 0) {
    const text = textOf(turn.content);
    deps.onEvent?.({ type: "token", text });
    return carried(working, deps, { messages: nextMessages, holds, trace, resolution: null, computerStream: working.computerStream, sandboxId: working.sandboxId, finalAnswer: text, route: "verify" as const, status: "running" });
  }
  for (const call of calls) deps.onEvent?.({ type: "tool", name: call.name, status: "start", summary: summarizeInput(call.input) });
  return carried(working, deps, { messages: nextMessages, holds, trace, resolution: null, computerStream: working.computerStream, sandboxId: working.sandboxId, route: "tools" as const, status: "running", toolCalls: working.toolCalls + calls.length });
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
      emitAsk(deps, pause.toolUseId, pause);
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
    const hold = holdFromPending(pause, -1);
    const waiting: ToolResult = { type: "tool_result", tool_use_id: pause.toolUseId, content: waitingNote(hold) };
    deps.onEvent?.({ type: "hold", hold });
    return {
      messages: [...state.messages, { role: "user" as const, content: orderResults(pause.order.length ? pause.order : [pause.toolUseId], pause.siblingResults, waiting) }],
      holds: [...state.holds, hold],
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
      touchedAt: deps.now(),
    };
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
    touchedAt: deps.now(),
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
      touchedAt: deps.now(),
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
    ...pauseActiveClock(state, deps.now()),
    touchedAt: deps.now(),
  };
}

function askNode(state: AgenticState, deps: AgenticDeps) {
  const pending = state.pending;
  if (!pending || pending.kind !== "ask") return { route: "agent" as const, pending: null, ...resumeAfterWait(state, deps.now()) };
  const answer = interrupt({
    kind: "ask",
    id: pending.toolUseId,
    question: pending.question ?? "",
    choices: pending.choices ?? [],
    options: pending.options ?? [],
    multiSelect: pending.multiSelect === true,
    allowCustom: pending.allowCustom === true,
    streamUrl: state.computerStream || undefined,
  });
  if (isDefer(answer)) return parkLegacy(state, pending, answer, deps);
  const text = resumeText(answer);
  if (pending.computer) {
    return {
      pending: { ...pending, phase: "resume-computer" as const, resume: { kind: "ask" as const, text } },
      route: "tools" as const,
      status: "running",
    };
  }
  const norm = normalizeResolution("ask", answer);
  const hold = resolvedHold(pending, norm, state.messages.length);
  deps.onEvent?.({ type: "hold", hold });
  return {
    ...finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content: text || "(no answer)" }),
    holds: upsertHold(state.holds, hold),
    ...resumeAfterWait(state, deps.now()),
  };
}

async function approveNode(state: AgenticState, deps: AgenticDeps) {
  const pending = state.pending;
  if (!pending || pending.kind !== "approval") return { route: "agent" as const, pending: null, ...resumeAfterWait(state, deps.now()) };
  const decision = interrupt({
    kind: "approval",
    id: pending.toolUseId,
    tool: pending.tool ?? "",
    args: pending.args ?? {},
    summary: pending.summary ?? "Approve this action?",
    digest: pending.digest ?? "",
  });
  if (isDefer(decision)) return parkLegacy(state, pending, decision, deps);
  const parsed = normalizeResolution("approval", decision);
  if (pending.computer && parsed.decision !== "reject") {
    return {
      pending: { ...pending, phase: "resume-computer" as const, resume: { kind: "approval" as const, decision: parsed.decision === "edit" ? "edit" : "approve", text: parsed.text, args: parsed.args } },
      route: "tools" as const,
      status: "running",
    };
  }
  try {
    const ran = await runApproval(state, pending, parsed, deps);
    const hold = resolvedHold(pending, parsed, state.messages.length, ran.args);
    deps.onEvent?.({ type: "hold", hold });
    return {
      ...finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content: ran.content, is_error: ran.isError }, ran.trace),
      holds: upsertHold(state.holds, hold),
      ...resumeAfterWait(state, deps.now()),
    };
  } catch (error) {
    return failedLegacy(state, pending, error, deps);
  }
}

function connectNode(state: AgenticState, deps: AgenticDeps) {
  const pending = state.pending;
  if (!pending || pending.kind !== "connect") return { route: "agent" as const, pending: null, ...resumeAfterWait(state, deps.now()) };
  const answer = interrupt({ kind: "connect", id: pending.toolUseId, app: pending.app ?? "", url: pending.url ?? "", question: pending.question ?? `Connect ${pending.app}?` });
  if (isDefer(answer)) return parkLegacy(state, pending, answer, deps);
  const norm = normalizeResolution("connect", answer);
  const declined = norm.decision === "decline";
  const content = declined
    ? `The user declined to connect ${pending.app}. Offer an alternative such as notes or text they can paste. Do not send the same connect link again.`
    : `The user connected ${pending.app}. Continue the original task without asking them to restate it.`;
  const hold = resolvedHold(pending, norm, state.messages.length);
  deps.onEvent?.({ type: "hold", hold });
  return {
    ...finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content }),
    holds: upsertHold(state.holds, hold),
    ...resumeAfterWait(state, deps.now()),
  };
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
    if (call.name === "search_web") {
      const outcome = await deps.tools.searchWeb(state.userId, call.input);
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "fetch_url") {
      const outcome = await deps.tools.fetchUrl(state.userId, String(call.input.url ?? ""));
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
        deps.onEvent?.({ type: "connect", id: call.id, app: outcome.connect.app, url: outcome.connect.url });
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
    if (call.name === "schedule_task") {
      const parsed = scheduleFromToolArgs(call.input, state.goal);
      if (!parsed.ok) return fail(base, call, parsed.error);
      base.pause = {
        kind: "approval",
        toolUseId: call.id,
        tool: "schedule_task",
        args: call.input,
        summary: parsed.summary,
        digest: `schedule:${parsed.draft.name}`,
        siblingResults: [],
        order: [],
      };
      deps.onEvent?.({ type: "approval", id: call.id, tool: "schedule_task", args: call.input, summary: parsed.summary });
      base.trace.push({ tool: "schedule_task", args: call.input, ok: false, effect: "write_internal", queued: true });
      note(deps, call, "ok", parsed.summary.slice(0, 140));
      return base;
    }
    if (call.name === "execute_tools") {
      const gate = executionHolds(call.input);
      if (gate.unknown.length && !gate.hold) {
        return fail(base, call, `Unknown or disallowed tools: ${gate.unknown.join(", ")}. Search again and use a real slug.`);
      }
      if (gate.hold && !state.allowExternal) {
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
        deps.onEvent?.({ type: "approval", id: call.id, tool: call.name, args: call.input, summary: base.pause.summary ?? "" });
        base.trace.push({ tool: "execute_tools", args: call.input, ok: false, effect: "external", queued: true });
        return base;
      }
      const outcome = await deps.tools.executeTools(state.userId, call.input);
      return applyOutcome(base, call, outcome, deps);
    }
    if (call.name === "use_computer") {
      if (!allowsComputer(state.modelId)) {
        return fail(base, call, "This model cannot drive the desktop. Continue with search, apps, or the web.");
      }
      const task = String(call.input.task ?? "");
      const result = await deps.computer.run({ userId: state.userId, task });
      if (result.streamUrl) {
        base.computerStream = result.streamUrl;
        base.sandboxId = result.sandboxId ?? base.sandboxId;
        deps.onEvent?.({ type: "computer", streamUrl: result.streamUrl, sandboxId: result.sandboxId ?? "" });
      }
      if (result.status === "ask" || result.status === "approval") {
        base.pause = computerPause(call.id, result);
        if (result.status === "ask") emitAsk(deps, call.id, result);
        else deps.onEvent?.({ type: "approval", id: call.id, tool: call.name, args: result.action, summary: result.summary });
        return base;
      }
      if (result.status === "error") {
        const failed = fail(base, call, computerStatusText(result));
        failed.result = computerToolResult(call.id, result);
        return failed;
      }
      base.result = computerToolResult(call.id, result);
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
    const hold = { ...holdFromPending(next, -1), id: `${pending.toolUseId}:${randomUUID().slice(0, 8)}` };
    if (result.status === "ask") emitAsk(deps, hold.id, result);
    else deps.onEvent?.({ type: "approval", id: hold.id, tool: pending.tool || next.tool || "", args: result.action, summary: result.summary });
    deps.onEvent?.({ type: "hold", hold });
    return {
      ...finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content: waitingNote(hold) }),
      holds: [...state.holds, hold],
      computerStream,
      sandboxId,
      pending: null,
    };
  }
  const isError = result.status === "error";
  const content = computerStatusText(result);
  const approaches = isError ? rememberApproach(state.approaches, approachKey("use_computer", { task: pending.computer?.task ?? "" })) : state.approaches;
  if (isError) deps.onEvent?.({ type: "tool", name: "use_computer", status: "error", summary: result.message.slice(0, 140) });
  else deps.onEvent?.({ type: "tool", name: "use_computer", status: "ok", summary: result.summary.slice(0, 140) });
  return {
    ...finishPause(state, pending, computerToolResult(pending.toolUseId, result), [
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

function resolvedHold(pending: Pending, norm: ReturnType<typeof normalizeResolution>, at: number, args?: Record<string, unknown>): Hold {
  const base = holdFromPending(pending, at);
  return {
    ...base,
    id: norm.id || base.id,
    status: "resolved",
    error: undefined,
    args: args ?? norm.args ?? base.args,
    resolution: { decision: norm.decision, label: norm.label, selected: norm.selected, args: norm.args, text: norm.text },
  };
}

function parkLegacy(state: AgenticState, pending: Pending, raw: unknown, deps: AgenticDeps) {
  const norm = normalizeResolution(pending.kind, raw);
  const hold = { ...holdFromPending(pending, state.messages.length), id: norm.id || pending.toolUseId, status: "pending" as const, error: undefined };
  deps.onEvent?.({ type: "hold", hold });
  const parked = finishPause(state, pending, { type: "tool_result", tool_use_id: pending.toolUseId, content: waitingNote(hold) });
  const messages = norm.followUp ? [...parked.messages, { role: "user" as const, content: norm.followUp }] : parked.messages;
  return { ...parked, messages, holds: upsertHold(state.holds, hold), pending: null, route: "agent" as const, status: "running" };
}

function failedLegacy(state: AgenticState, pending: Pending, error: unknown, deps: AgenticDeps) {
  const friendly = publicError(error);
  const norm = normalizeResolution(pending.kind, {});
  const hold = { ...holdFromPending(pending, state.messages.length), id: norm.id || pending.toolUseId, status: "pending" as const, error: friendly };
  deps.onEvent?.({ type: "hold", hold });
  const parked = finishPause(state, pending, {
    type: "tool_result",
    tool_use_id: pending.toolUseId,
    is_error: true,
    content: `${waitingNote(hold)} ${friendly}`,
  });
  return {
    ...parked,
    messages: [...parked.messages, { role: "assistant" as const, content: friendly }],
    holds: upsertHold(state.holds, hold),
    pending: null,
    finalAnswer: friendly,
    route: "end" as const,
    status: "done",
  };
}

async function applyResolution(state: AgenticState, deps: AgenticDeps): Promise<Partial<AgenticState> & { resetBudget?: boolean }> {
  const request = state.resolution;
  if (!request || request.defer) return { resolution: null, route: "agent" };
  const holds = state.holds ?? [];
  const index = holds.findIndex((hold) => hold.id === request.id && hold.status === "pending");
  if (index < 0) {
    return {
      resolution: null,
      messages: [...state.messages, { role: "user" as const, content: `${HOLD_UPDATE_PREFIX} That choice is not waiting anymore. Continue the conversation.` }],
    };
  }
  const hold = holds[index];
  const norm = normalizeResolution(hold.kind, request);
  if (hold.kind === "ask" && hold.budget) return resolveBudget(state, holds, index, hold, norm, deps);
  try {
    const ran = await runHold(state, hold, norm, deps);
    const resolved: Hold = {
      ...hold,
      status: "resolved",
      error: undefined,
      args: ran.args ?? hold.args,
      resolution: { decision: norm.decision, label: norm.label, selected: norm.selected, args: norm.args, text: norm.text },
    };
    let nextHolds = holds.map((item, i) => (i === index ? resolved : item));
    for (const extra of ran.holds) nextHolds = upsertHold(nextHolds, extra);
    deps.onEvent?.({ type: "hold", hold: resolved });
    for (const extra of ran.holds) deps.onEvent?.({ type: "hold", hold: extra });
    return {
      resolution: null,
      holds: nextHolds,
      trace: [...state.trace, ...ran.trace],
      messages: [...state.messages, { role: "user" as const, content: holdFollowUp(norm.label, ran) }],
      connectLinks: ran.connectLinks ?? state.connectLinks,
      computerStream: ran.computerStream || state.computerStream,
      sandboxId: ran.sandboxId || state.sandboxId,
    };
  } catch (error) {
    const friendly = publicError(error);
    const pending = { ...hold, status: "pending" as const, error: friendly };
    deps.onEvent?.({ type: "hold", hold: pending });
    return {
      resolution: null,
      holds: holds.map((item, i) => (i === index ? pending : item)),
      messages: [
        ...state.messages,
        { role: "user" as const, content: `${HOLD_UPDATE_PREFIX} The user tried to resolve a waiting action but it failed. It is still waiting. ${friendly}` },
        { role: "assistant" as const, content: friendly },
      ],
      finalAnswer: friendly,
      route: "end" as const,
      status: "done",
    };
  }
}

async function runApproval(
  state: AgenticState,
  pending: Pending,
  norm: ReturnType<typeof normalizeResolution>,
  deps: AgenticDeps
): Promise<{ content: string; isError: boolean; trace: TraceStep[]; args: Record<string, unknown> }> {
  const tool = pending.tool || pending.kind;
  const args = norm.decision === "edit" && norm.args ? norm.args : pending.args ?? {};
  if (tool === "schedule_task") {
    if (norm.decision === "reject") {
      return {
        content: "The user did not save this schedule. Nothing was scheduled.",
        isError: true,
        args,
        trace: [{ tool, args, ok: false, effect: "write_internal", denied: true, error: "rejected" }],
      };
    }
    const saved = await deps.schedules.save({ userId: state.userId, threadId: state.threadId, goal: state.goal, messages: state.messages, args });
    return {
      content: saved.message,
      isError: !saved.ok,
      args,
      trace: [{ tool, args, ok: saved.ok, effect: "write_internal", error: saved.ok ? undefined : saved.message.slice(0, 200) }],
    };
  }
  if (norm.decision === "reject") {
    return {
      content: "The user rejected this action. Nothing was sent, deleted, or paid.",
      isError: true,
      args,
      trace: [{ tool, args, ok: false, effect: "external", denied: true, error: "rejected" }],
    };
  }
  const key = actionDigest(tool, args);
  const cached = await deps.ledger.get(state.userId, key);
  if (cached) return { content: cached, isError: false, args, trace: [{ tool, args, ok: true, effect: "external" }] };
  const outcome = await deps.tools.executeTools(state.userId, args);
  if (!outcome.isError) await deps.ledger.put(state.userId, key, outcome.content).catch(() => undefined);
  const content = outcome.isError ? outcome.content : wrapUntrusted(tool, outcome.content);
  return {
    content,
    isError: outcome.isError,
    args,
    trace: [{ tool, args, ok: !outcome.isError, effect: "external", error: outcome.isError ? outcome.content.slice(0, 200) : undefined }],
  };
}

async function runHold(state: AgenticState, hold: Hold, norm: ReturnType<typeof normalizeResolution>, deps: AgenticDeps): Promise<{
  content: string;
  blocks?: ContentBlock[];
  trace: TraceStep[];
  holds: Hold[];
  args?: Record<string, unknown>;
  connectLinks?: ConnectLink[];
  computerStream?: string;
  sandboxId?: string;
}> {
  if (hold.computer && hold.kind !== "connect") {
    if (norm.decision === "reject") {
      return { content: "The user rejected this action. Nothing was sent, deleted, or paid.", trace: [{ tool: hold.tool || hold.kind, args: hold.args ?? {}, ok: false, effect: "external", denied: true, error: "rejected" }], holds: [], args: hold.args };
    }
    const result = await deps.computer.run({
      userId: state.userId,
      task: hold.computer.task,
      checkpoint: hold.computer,
      resume: { kind: hold.kind === "approval" ? "approval" : "ask", text: norm.text, decision: norm.decision === "edit" ? "edit" : norm.decision === "approve" ? "approve" : undefined, args: norm.args },
    });
    if (result.status === "ask" || result.status === "approval") {
      const next = computerPause(hold.toolUseId, result);
      const extra = { ...holdFromPending(next, -1), id: `${hold.id}:${randomUUID().slice(0, 8)}` };
      return { content: waitingNote(extra), trace: [], holds: [extra], computerStream: result.streamUrl || undefined, sandboxId: result.sandboxId || undefined };
    }
    if (result.status === "error") {
      const text = computerStatusText(result);
      return { content: text, blocks: computerBlocks(result), trace: [{ tool: hold.tool || hold.kind, args: hold.args ?? {}, ok: false, effect: "read", error: text.slice(0, 200) }], holds: [], computerStream: result.streamUrl || undefined, sandboxId: result.sandboxId || undefined };
    }
    return { content: computerStatusText(result), blocks: computerBlocks(result), trace: [{ tool: hold.tool || hold.kind, args: { task: hold.computer.task }, ok: true, effect: "read" }], holds: [], computerStream: result.streamUrl || undefined, sandboxId: result.sandboxId || undefined };
  }
  if (hold.kind === "ask") return { content: norm.text || norm.label || "(no answer)", trace: [], holds: [] };
  if (hold.kind === "connect") {
    const declined = norm.decision === "decline";
    return {
      content: declined
        ? `The user declined to connect ${hold.app ?? "the app"}. Offer another way. Do not send the same connect link again.`
        : `The user connected ${hold.app ?? "the app"}. Continue the original task without asking them to restate it.`,
      trace: [],
      holds: [],
    };
  }
  const pending: Pending = { ...hold, kind: "approval", siblingResults: [], order: [] };
  const ran = await runApproval(state, pending, norm, deps);
  return { content: ran.content, trace: ran.trace, holds: [], args: ran.args };
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
  const pending: Pending = { kind: "ask", toolUseId: id, ...askFields(ask), siblingResults: [], order: [id] };
  const hold = holdFromPending(pending, state.messages.length + 1);
  emitAsk(deps, id, ask);
  deps.onEvent?.({ type: "hold", hold });
  const messages: AgenticMessage[] = [
    ...state.messages,
    { role: "user", content: orderResults(calls.map((call) => call.id), results) },
    { role: "assistant", content: [{ type: "text", text: ask.question }] },
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
    holds: [...state.holds, hold],
    pending: null,
    finalAnswer: ask.question,
    route: "end" as const,
    status: "ask_user",
    toolCalls: state.toolCalls + 1,
    ...pauseActiveClock(state, deps.now()),
    touchedAt: deps.now(),
  };
}

function toolsForPlan(modelId: string, plan: string) {
  const tools = selectTools(modelId, agentToolSchemas());
  if (plan !== "free") return tools;
  return tools.filter((tool) => tool.name !== "use_computer");
}

function stopForCredits(messages: AgenticMessage[], state: AgenticState, message: string) {
  return {
    messages: [...messages, { role: "assistant" as const, content: [{ type: "text" as const, text: message }] }],
    holds: state.holds,
    trace: state.trace,
    resolution: null,
    computerStream: state.computerStream,
    sandboxId: state.sandboxId,
    finalAnswer: message,
    route: "end" as const,
    status: "done" as const,
  };
}

const BUDGET_INTENT_SYSTEM =
  "Classify the user's reply after an agent hit its time or tool budget. Reply with exactly one word: continue or stop. continue means keep working, including any new instruction. stop means cancel and end the turn.";

function forceAsk(messages: AgenticMessage[], state: AgenticState, reason: string, deps: AgenticDeps) {
  const id = `ask-${randomUUID()}`;
  const ask = parseAskInput({
    question: budgetQuestion(state, reason),
    options: [
      { label: "Keep going", value: "continue", description: "Reset the timer and keep working on this task." },
      { label: "Stop here", value: "stop", description: "End this turn and keep what is already done." },
    ],
    allowCustom: true,
  });
  const pending: Pending = { kind: "ask", toolUseId: id, ...askFields(ask), siblingResults: [], order: [id] };
  const hold = { ...holdFromPending(pending, messages.length), budget: true };
  emitAsk(deps, id, ask);
  deps.onEvent?.({ type: "hold", hold });
  return {
    messages: [...messages, { role: "assistant" as const, content: [{ type: "text" as const, text: ask.question }] }],
    holds: [...state.holds, hold],
    pending: null,
    finalAnswer: ask.question,
    route: "end" as const,
    status: "ask_user",
    toolCalls: state.toolCalls + 1,
  };
}

function budgetQuestion(state: AgenticState, reason: string): string {
  return `${reason} ${workSoFar(state)} How should I continue?`.slice(0, 500);
}

function workSoFar(state: AgenticState): string {
  const done = state.todos.filter((item) => item.status === "done").map((item) => item.title).slice(0, 3);
  const tools = [...new Set(state.trace.map((step) => step.tool))].slice(-3);
  if (done.length) return `Done so far: ${done.join(", ")}.`;
  if (tools.length) return `So far I used ${tools.join(", ")}.`;
  if (state.approaches.length) return `I tried ${state.approaches.length} ${state.approaches.length === 1 ? "approach" : "approaches"}.`;
  return "I was still working on this.";
}

function stopSummary(state: AgenticState): string {
  const done = state.todos.filter((item) => item.status === "done").map((item) => item.title).slice(0, 4);
  const tools = [...new Set(state.trace.map((step) => step.tool))].slice(-4);
  if (done.length) return `Stopped here. Finished: ${done.join(", ")}.`;
  if (tools.length) return `Stopped here. So far I used ${tools.join(", ")}.`;
  return "Stopped here. Nothing else was changed.";
}

async function budgetIntent(answer: string, deps: AgenticDeps): Promise<BudgetIntent> {
  const known = knownBudgetIntent(answer);
  if (known) return known;
  const text = answer.trim();
  if (!text) return "continue";
  try {
    const turn = await deps.claude.complete({
      system: BUDGET_INTENT_SYSTEM,
      messages: [{ role: "user", content: text }],
      tools: [],
    });
    return budgetIntentFromModel(textOf(turn.content));
  } catch {
    return "continue";
  }
}

async function resolveBudget(
  state: AgenticState,
  holds: Hold[],
  index: number,
  hold: Hold,
  norm: ReturnType<typeof normalizeResolution>,
  deps: AgenticDeps
): Promise<Partial<AgenticState> & { resetBudget?: boolean }> {
  const answer = (norm.text || norm.label || "").trim();
  const intent = await budgetIntent(answer, deps);
  const label = intent === "stop" ? "Stop here" : knownBudgetIntent(answer) === "continue" || !answer ? "Keep going" : answer;
  const resolved: Hold = {
    ...hold,
    status: "resolved",
    error: undefined,
    resolution: { decision: intent, label, selected: norm.selected, text: norm.text || answer },
  };
  const nextHolds = holds.map((item, i) => (i === index ? resolved : item));
  deps.onEvent?.({ type: "hold", hold: resolved });
  if (intent === "stop") {
    const summary = stopSummary(state);
    deps.onEvent?.({ type: "thinking", text: "Stopping here." });
    return {
      resolution: null,
      holds: nextHolds,
      messages: [...state.messages, { role: "user" as const, content: `${HOLD_UPDATE_PREFIX} The user chose to stop.` }],
      finalAnswer: summary,
      route: "end",
      status: "done",
      ...pauseActiveClock(state, deps.now()),
    };
  }
  const instruction = answer && knownBudgetIntent(answer) !== "continue" ? answer : "Keep going";
  return {
    resetBudget: true,
    resolution: null,
    holds: nextHolds,
    messages: [
      ...state.messages,
      {
        role: "user" as const,
        content: `${HOLD_UPDATE_PREFIX} The user chose "${label}". Result: ${instruction}. Continue the same task with a fresh time and tool budget.`,
      },
    ],
    finalAnswer: "",
    status: "running",
    toolCalls: 0,
  };
}

function budgetReason(state: AgenticState, deps: AgenticDeps): string | null {
  if (state.toolCalls >= deps.budgets.maxToolCalls) return `I used ${state.toolCalls} tool calls, which is the budget for this turn.`;
  if (activeElapsed(state, deps.now()) > deps.budgets.wallClockMs) return "This turn reached its active time budget.";
  return null;
}

function carried<T extends Record<string, unknown>>(working: AgenticState, deps: AgenticDeps, patch: T) {
  return { ...patch, startedAt: working.startedAt, activeMs: working.activeMs ?? 0, touchedAt: deps.now() };
}

/** A resumed interrupt starts a new active segment and does not bill the wait. */
function resumeAfterWait(state: AgenticState, now: number) {
  const settled = settleActiveClock(state.startedAt ? { ...state, touchedAt: state.touchedAt || state.startedAt } : state, now, 0);
  return { startedAt: now, activeMs: state.startedAt ? settled.activeMs : (state.activeMs ?? 0), touchedAt: now };
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

function emitAsk(deps: AgenticDeps, id: string, source: { question?: string; choices?: string[]; options?: AskPrompt["options"]; multiSelect?: boolean; allowCustom?: boolean }) {
  const ask = parseAskInput(source);
  deps.onEvent?.({ type: "ask", id, ...askFields(ask) });
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
    const text = resultText(result);
    if (!text) continue;
    const hint = await deps.critic.hint({ request, tool: result.tool_use_id, result: text }).catch(() => "unsure" as const);
    if (!hint || hint === "unsure") continue;
    const note = `\n\nCritic hint: ${hint}. Ignore this if it does not help.`;
    if (typeof result.content === "string") {
      result.content = `${text}${note}`;
      continue;
    }
    let used = false;
    result.content = result.content.map((part) => {
      if (part.type !== "text" || used) return part;
      used = true;
      return { ...part, text: `${part.text}${note}` };
    });
  }
}

function resultText(result: ToolResult): string {
  if (typeof result.content === "string") return result.content;
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function computerBlocks(result: Extract<ComputerRunResult, { status: "done" | "error" }>): ContentBlock[] | undefined {
  const content = computerToolResult("computer", result).content;
  return Array.isArray(content) ? content : undefined;
}

function holdFollowUp(label: string, ran: { content: string; blocks?: ContentBlock[] }): string | ContentBlock[] {
  const prefix = `${HOLD_UPDATE_PREFIX} The user chose "${label}". Result: `;
  if (!ran.blocks?.length) return `${prefix}${ran.content}`;
  let prefixed = false;
  return ran.blocks.map((block) => {
    if (block.type === "text" && !prefixed) {
      prefixed = true;
      return { ...block, text: `${prefix}${block.text}` };
    }
    return block;
  });
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
  const text = String(input.query ?? input.task ?? input.goal ?? input.question ?? input.toolkit ?? input.url ?? "");
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
      async searchWeb() { return { content: "search_web is not configured.", isError: true }; },
      async fetchUrl() { return { content: "fetch_url is not configured.", isError: true }; },
      async research() { return { content: "Research is not configured.", isError: true }; },
    },
    memory: { async addFact() {}, async recall() { return { facts: [], episodes: [] }; }, async addEpisode() {} },
    computer: { async run() { return { status: "error", message: "Desktop is not configured." }; } },
    ledger: { async get() { return null; }, async put() {} },
    schedules: { async save() { return { ok: true, message: "Schedule saved." }; } },
    summarize: async (messages) => fallbackSummary(messages),
    now: () => Date.now(),
    ...overrides,
  };
}
