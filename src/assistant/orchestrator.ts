import { randomUUID } from "node:crypto";
import type { ApprovalRecord, ChatMessage, Checkpoint, Plan, Quota, RunEvent, Span, StopReason, TraceEntry } from "./types";
import type { ModelClient } from "./types";
import type { AssistantStore } from "./builtin";
import type { ToolHub } from "./hub";
import { gateDecision } from "./policy";
import { composeReply, screenInput, screenOutput, wrapUntrusted } from "./filters";
import { selectTools, allowlist } from "./registry";
import { fitContext } from "./context";
import { retrieve } from "./memory";
import { parseAct, parsePlan } from "./planner";
import { actionDigest, canResolve } from "./approvals";
import { allowRate, allowSpend, costUsd } from "./cost";
import { createTracer } from "./trace";
import { canonical, idempotencyKey } from "./util";
import { ACT_INSTRUCTION, PLAN_INSTRUCTION, POLICY_SYSTEM } from "./prompts";
import { ensureActionTools, nudgePlan, unconnectedApps, withConnectTool } from "./apps";
import { extensionDelegate, runResearch } from "./subagent";
import { ModelUnavailableError } from "./model-client";

const BUDGETS = {
  maxSteps: 8,
  maxTokens: 20_000,
  contextChars: 12_000,
  approvalTtlMs: 72 * 60 * 60 * 1000,
  maxIdentical: 2,
  innerLoops: 4,
};

export type TurnInput = {
  userId: string;
  conversationId: string;
  taskId: string;
  text: string;
  untrustedContext?: string;
  trigger: "chat" | "schedule" | "event";
  history: ChatMessage[];
  facts: { id: string; text: string; userId?: string; embedding?: number[] }[];
  episodes: { summary: string; lesson: string }[];
  chunks: { id: string; text: string; userId?: string; sourceId?: string; embedding?: number[] }[];
  connections: { toolkit: string; status: string; scopes: string }[];
  catalog?: string[];
  ownerEmail?: string;
  quota: Quota;
  resume?: {
    checkpoint: Checkpoint;
    approval: ApprovalRecord;
    decision: "approve" | "reject";
    editedArgs?: Record<string, unknown>;
  };
};

export type Deps = {
  model: ModelClient;
  hub: ToolHub;
  store: AssistantStore;
  now: () => Date;
  budgets?: Partial<typeof BUDGETS>;
  onEvent?: (event: RunEvent) => void;
  connectApp?: (userId: string, app: string) => Promise<{ url: string; app: string } | { error: string }>;
};

export type RunResult = {
  stopReason: StopReason;
  reply: string;
  trace: TraceEntry[];
  spans: Span[];
  checkpoint: Checkpoint | null;
  approval: { id: string; tool: string; args: Record<string, unknown>; expiresAt: string } | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

type LoopState = {
  inputTokens: number;
  outputTokens: number;
  spent: number;
  model: string;
  trace: TraceEntry[];
  observations: string[];
  toolCalls: number;
  repairs: number;
};

export async function runTurn(input: TurnInput, deps: Deps): Promise<RunResult> {
  const budgets = { ...BUDGETS, ...deps.budgets };
  const tracer = createTracer(() => deps.now().getTime());
  const emit = deps.onEvent ?? (() => {});
  const state: LoopState = {
    inputTokens: 0,
    outputTokens: 0,
    spent: 0,
    model: "claude-sonnet-4-5",
    trace: [],
    observations: [],
    toolCalls: 0,
    repairs: 0,
  };

  const finish = async (
    stopReason: StopReason,
    reply: string,
    checkpoint: Checkpoint | null,
    approval: RunResult["approval"]
  ): Promise<RunResult> => {
    const offered = await attachConnectOffers(reply, input, deps);
    const safe = screenOutput(composeReply(offered, state.trace));
    const summary = safe.text.slice(0, 500);
    if (stopReason !== "INPUT_BLOCKED" && stopReason !== "RATE_LIMIT") {
      await deps.store.addEpisode(input.userId, {
        taskId: input.taskId,
        summary,
        lesson: `Stop ${stopReason}. Tools: ${state.trace.map((t) => t.tool).join(", ") || "none"}.`,
      });
    }
    tracer.span("turn", { stopReason, trigger: input.trigger, tools: state.trace.length });
    return {
      stopReason,
      reply: safe.text,
      trace: state.trace,
      spans: tracer.spans,
      checkpoint,
      approval,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      costUsd: state.spent,
    };
  };

  if (input.resume) return resume(input, deps, budgets, state, finish, emit);

  const screened = screenInput(input.text);
  if (!screened.ok) {
    const reply =
      screened.reason === "jailbreak"
        ? "I can't follow a request to ignore my rules."
        : "Send a shorter message and I'll take it from there.";
    return finish("INPUT_BLOCKED", reply, null, null);
  }
  if (!allowRate(input.quota.recentTurns, input.quota.recentLimit)) {
    return finish("RATE_LIMIT", "Too many requests in a short window. Wait a minute and try again.", null, null);
  }
  if (!allowSpend(input.quota.dailySpendUsd, input.quota.dailyLimitUsd)) {
    return finish("COST_BUDGET", "Today's model budget is used up.", null, null);
  }

  const factHits = retrieve(input.text, input.facts, { userId: input.userId, limit: 5 });
  const chunkHits = retrieve(input.text, input.chunks, { userId: input.userId, limit: 4 });
  const history = [...input.history, { role: "user" as const, content: input.text }];

  let planResult: ReturnType<typeof parsePlan> | null = null;
  for (let attempt = 0; attempt < 2 && (!planResult || !planResult.ok); attempt++) {
    const response = await complete(deps, state, input, "plan", `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${PLAN_INSTRUCTION}`, pack(history, factHits.map((f) => f.text), input, budgets));
    if (!response) return finish("MODEL_UNAVAILABLE", "The model provider is not configured or is unavailable.", null, null);
    planResult = parsePlan(response.text);
  }
  if (!planResult || !planResult.ok) return finish("FAILED", "I couldn't make a usable plan for that.", null, null);
  const plan = nudgePlan(planResult.plan, input);
  tracer.span("plan", { intent: plan.intent, steps: plan.steps.length });

  if (plan.intent === "answer_from_docs" && chunkHits.length === 0) {
    return finish("ABSTAIN", "I don't have a document that answers that. Upload the file or connect the app that has it.", null, null);
  }

  if (plan.intent === "chat" || plan.intent === "answer_from_docs") {
    const system = `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${ACT_INSTRUCTION}\nNo tools on this turn. Put the reply in JSON and cite document ids when you use them.`;
    const response = await complete(deps, state, input, "act", system, pack(history, [...factHits.map((f) => f.text), ...chunkHits.map((c) => `${c.id}: ${c.text}`)], input, budgets));
    if (!response) return finish("MODEL_UNAVAILABLE", "The model provider is not configured or is unavailable.", null, null);
    const act = parseAct(response.text);
    const reply = act.ok ? act.act.reply : response.text;
    if (plan.intent === "answer_from_docs" && !chunkHits.some((chunk) => reply.includes(chunk.id))) {
      return finish("ABSTAIN", "I found documents but couldn't ground an answer in them.", null, null);
    }
    return finish("MODEL_ANSWER", reply || plan.success, null, null);
  }

  for (let index = 0; index < plan.steps.length; index++) {
    const stepResult = await runStep(plan, index, input, deps, budgets, state, factHits.map((f) => f.text), history, emit);
    if (stepResult) return finish(stepResult.stopReason, stepResult.reply, stepResult.checkpoint, stepResult.approval);
  }

  const reply = state.observations.filter((line) => !line.startsWith("<untrusted")).at(-1) || plan.success;
  return finish("MODEL_ANSWER", reply, null, null);
}

async function resume(
  input: TurnInput,
  deps: Deps,
  budgets: typeof BUDGETS,
  state: LoopState,
  finish: (stop: StopReason, reply: string, checkpoint: Checkpoint | null, approval: RunResult["approval"]) => Promise<RunResult>,
  emit: (event: RunEvent) => void
): Promise<RunResult> {
  const resumeFrom = input.resume!;
  const check = canResolve(resumeFrom.approval, input.userId, deps.now());
  if (!check.ok) {
    if (check.reason === "expired") {
      await deps.store.markApproval(input.userId, resumeFrom.approval.id, {
        status: "expired",
        result: "expired",
        args: resumeFrom.approval.args,
        digest: resumeFrom.approval.digest,
      });
      await deps.store.audit(input.userId, "approval_expired", resumeFrom.approval.tool, resumeFrom.approval.id);
      return finish("WAITING_EXPIRED", "That approval expired. Nothing was sent.", null, null);
    }
    await deps.store.audit(input.userId, "approval_rejected", resumeFrom.approval.tool, check.reason);
    return finish("DENIED", "That approval can no longer be used.", null, null);
  }
  if (resumeFrom.decision === "reject") {
    await deps.store.markApproval(input.userId, resumeFrom.approval.id, {
      status: "rejected",
      result: "rejected",
      args: resumeFrom.approval.args,
      digest: resumeFrom.approval.digest,
    });
    await deps.store.audit(input.userId, "approval_rejected", resumeFrom.approval.tool, "owner rejected");
    return finish("REJECTED", "You rejected the action. Nothing was sent, deleted, or paid.", null, null);
  }
  if (!allowSpend(input.quota.dailySpendUsd, input.quota.dailyLimitUsd)) {
    return finish("COST_BUDGET", "Today's model budget is used up, so I did not run the approved action.", null, null);
  }
  const args = resumeFrom.editedArgs ?? resumeFrom.approval.args;
  const digest = actionDigest(resumeFrom.approval.tool, args);
  const marked = await deps.store.markApproval(input.userId, resumeFrom.approval.id, {
    status: "approved",
    result: "approved",
    args,
    digest,
  });
  if (!marked) {
    await deps.store.audit(input.userId, "approval_replay", resumeFrom.approval.tool, resumeFrom.approval.id);
    return finish("DENIED", "That approval was already used.", null, null);
  }
  const gate = gateDecision(resumeFrom.approval.tool);
  const cached = await deps.store.getEffect(input.userId, resumeFrom.approval.idempotencyKey);
  const result = cached ?? (await deps.hub.call(input.userId, resumeFrom.approval.tool, args, new Set([resumeFrom.approval.tool])));
  if (!cached) await deps.store.putEffect(input.userId, resumeFrom.approval.idempotencyKey, result);
  await deps.store.audit(input.userId, result.ok ? "tool_executed" : "tool_failed", resumeFrom.approval.tool, result.ok ? "approved" : result.error?.code ?? "failed");
  state.trace = resumeFrom.checkpoint.trace.filter((entry) => !(entry.queued && entry.tool === resumeFrom.approval.tool));
  state.trace.push({ tool: resumeFrom.approval.tool, args, effect: gate.effect, ok: result.ok, ...(result.ok ? {} : { error: result.error?.message }) });
  state.observations = [...resumeFrom.checkpoint.observations, wrapUntrusted(resumeFrom.approval.tool, JSON.stringify(result))];
  state.inputTokens = resumeFrom.checkpoint.inputTokens;
  state.outputTokens = resumeFrom.checkpoint.outputTokens;
  emit({ type: "tool", tool: resumeFrom.approval.tool, ok: result.ok });
  const history = [...input.history, { role: "user" as const, content: input.text }];
  for (let index = resumeFrom.checkpoint.nextStep; index < resumeFrom.checkpoint.plan.steps.length; index++) {
    const stepResult = await runStep(resumeFrom.checkpoint.plan, index, input, deps, budgets, state, [], history, emit);
    if (stepResult) return finish(stepResult.stopReason, stepResult.reply, stepResult.checkpoint, stepResult.approval);
  }
  return finish("MODEL_ANSWER", result.ok ? "The approved action ran." : "The approved action failed and was not retried as a new side effect.", null, null);
}

type StepStop = { stopReason: StopReason; reply: string; checkpoint: Checkpoint | null; approval: RunResult["approval"] };

async function runStep(
  plan: Plan,
  index: number,
  input: TurnInput,
  deps: Deps,
  budgets: typeof BUDGETS,
  state: LoopState,
  facts: string[],
  history: ChatMessage[],
  emit: (event: RunEvent) => void
): Promise<StepStop | null> {
  const step = plan.steps[index];
  if (state.toolCalls >= budgets.maxSteps) {
    return { stopReason: "STEP_BUDGET", reply: "I stopped because this task hit its step budget.", checkpoint: snapshot(plan, index, state), approval: null };
  }
  const listed = await deps.hub.list(input.userId, `${step.goal} ${step.toolQuery}`);
  if (step.delegate === "research") {
    try {
      const research = await runResearch({
        userId: input.userId,
        goal: step.goal,
        model: deps.model,
        hub: deps.hub,
        tools: selectTools(step.toolQuery, listed),
      });
      state.inputTokens += research.inputTokens;
      state.outputTokens += research.outputTokens;
      state.spent += costUsd("claude-sonnet-4-5", research.inputTokens, research.outputTokens);
      state.trace.push(...research.trace);
      state.observations.push(wrapUntrusted("research", research.summary));
      state.toolCalls += research.trace.length;
      return null;
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        return { stopReason: "MODEL_UNAVAILABLE", reply: "The model provider is not configured or is unavailable.", checkpoint: null, approval: null };
      }
      throw err;
    }
  }
  if (step.delegate === "email" || step.delegate === "coding") {
    state.observations.push(extensionDelegate(step.delegate));
  }
  const missing = unconnectedApps(input.text, input.catalog ?? [], activeToolkits(input));
  const actionQuery = missing.length ? `${step.goal} ${step.toolQuery}` : `${step.goal} ${step.toolQuery} ${input.text}`;
  const selected = withConnectTool(
    ensureActionTools(actionQuery, listed, selectTools(actionQuery, listed)),
    listed,
    missing.length > 0
  );
  const allowed = allowlist(selected);
  const toolLines = selected.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") || "(no tools matched this step)";
  for (let inner = 0; inner < budgets.innerLoops; inner++) {
    if (state.inputTokens + state.outputTokens >= budgets.maxTokens) {
      return { stopReason: "TOKEN_BUDGET", reply: "I stopped because this task hit its token budget.", checkpoint: snapshot(plan, index, state), approval: null };
    }
    const response = await complete(
      deps,
      state,
      input,
      "act",
      `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${ACT_INSTRUCTION}\nStep goal: ${step.goal}\nTools:\n${toolLines}`,
      pack(history, facts, input, budgets, state.observations)
    );
    if (!response) {
      return { stopReason: "MODEL_UNAVAILABLE", reply: "The model provider is not configured or is unavailable.", checkpoint: null, approval: null };
    }
    if (input.quota.dailySpendUsd + state.spent >= input.quota.dailyLimitUsd) {
      return { stopReason: "COST_BUDGET", reply: "Today's model budget is used up.", checkpoint: snapshot(plan, index, state), approval: null };
    }
    const parsed = parseAct(response.text);
    if (!parsed.ok) {
      state.repairs += 1;
      if (state.repairs > 1) return { stopReason: "FAILED", reply: "I got an unreadable tool response from the model and stopped.", checkpoint: null, approval: null };
      state.observations.push("Your last reply was not valid JSON. Reply with the JSON object only.");
      continue;
    }
    if (parsed.act.calls.length === 0) {
      if (parsed.act.reply) state.observations.push(parsed.act.reply);
      return null;
    }
    for (const call of parsed.act.calls) {
      if (state.toolCalls >= budgets.maxSteps) {
        return { stopReason: "STEP_BUDGET", reply: "I stopped because this task hit its step budget.", checkpoint: snapshot(plan, index, state), approval: null };
      }
      const spec = selected.find((tool) => tool.name === call.tool);
      const gate = gateDecision(call.tool, spec?.effect);
      const identical = state.trace.filter((entry) => entry.tool === call.tool && canonical(entry.args) === canonical(call.args)).length;
      if (identical >= budgets.maxIdentical) {
        return { stopReason: "LOOP_DETECTED", reply: "I stopped because the same tool call was repeating.", checkpoint: snapshot(plan, index, state), approval: null };
      }
      if (!allowed.has(call.tool) || !spec) {
        state.trace.push({ tool: call.tool, args: call.args, effect: gate.effect, ok: false, denied: true, error: "NOT_ALLOWLISTED" });
        await deps.store.audit(input.userId, "tool_denied", call.tool, "not allowlisted");
        state.observations.push(wrapUntrusted(call.tool, "This tool is not available for this step."));
        emit({ type: "tool", tool: call.tool, ok: false, denied: true });
        continue;
      }
      if (gate.decision === "deny") {
        state.trace.push({ tool: call.tool, args: call.args, effect: gate.effect, ok: false, denied: true, error: "DENIED" });
        await deps.store.audit(input.userId, "tool_denied", call.tool, "unknown effect");
        state.observations.push(wrapUntrusted(call.tool, "Denied. The effect of this tool is unknown."));
        emit({ type: "tool", tool: call.tool, ok: false, denied: true });
        continue;
      }
      const key = idempotencyKey([input.userId, input.conversationId, step.id, call.tool, call.args]);
      if (gate.decision === "hold") {
        const approvalId = randomUUID();
        const expiresAt = new Date(deps.now().getTime() + budgets.approvalTtlMs).toISOString();
        const digest = actionDigest(call.tool, call.args);
        await deps.store.createApproval({
          id: approvalId,
          userId: input.userId,
          taskId: input.taskId,
          tool: call.tool,
          args: call.args,
          digest,
          expiresAt,
          idempotencyKey: key,
        });
        await deps.store.audit(input.userId, "approval_requested", call.tool, digest);
        state.trace.push({ tool: call.tool, args: call.args, effect: gate.effect, ok: false, queued: true });
        emit({ type: "approval", approval: { id: approvalId, tool: call.tool, args: call.args, expiresAt } });
        const checkpoint = snapshot(plan, index + 1, state);
        checkpoint.held = { approvalId, stepIndex: index, tool: call.tool, args: call.args, idempotencyKey: key };
        return {
          stopReason: "WAITING_APPROVAL",
          reply: `I prepared ${call.tool} and stopped for your approval. Nothing was sent yet.`,
          checkpoint,
          approval: { id: approvalId, tool: call.tool, args: call.args, expiresAt },
        };
      }
      const cached = await deps.store.getEffect(input.userId, key);
      const result = cached ?? (await deps.hub.call(input.userId, call.tool, { ...call.args, idempotencyKey: key }, allowed));
      if (!cached) await deps.store.putEffect(input.userId, key, result);
      state.toolCalls += 1;
      state.trace.push({
        tool: call.tool,
        args: call.args,
        effect: gate.effect,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error?.message }),
      });
      await deps.store.audit(input.userId, result.ok ? "tool_executed" : "tool_failed", call.tool, result.ok ? "ok" : result.error?.code ?? "failed");
      state.observations.push(wrapUntrusted(call.tool, JSON.stringify(result)));
      emit({ type: "tool", tool: call.tool, ok: result.ok });
    }
    if (parsed.act.done) return null;
  }
  return null;
}

function snapshot(plan: Plan, nextStep: number, state: LoopState): Checkpoint {
  return {
    plan,
    nextStep,
    trace: state.trace,
    observations: state.observations,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
  };
}

function activeToolkits(input: TurnInput): string[] {
  return input.connections.filter((connection) => connection.status === "active").map((connection) => connection.toolkit);
}

function ownerBrief(input: TurnInput): string {
  const connected = activeToolkits(input);
  const missing = unconnectedApps(input.text, input.catalog ?? [], connected);
  const lines: string[] = [];
  if (input.ownerEmail) {
    lines.push(`The owner's email address is ${input.ownerEmail}. When they say me, my email, or my gmail, that is the recipient. Do not ask for it.`);
  }
  if (connected.length) lines.push(`Connected apps whose actions you can call: ${connected.join(", ")}.`);
  if (missing.length) {
    lines.push(`Not connected yet: ${missing.join(", ")}. Call builtin.apps.connect with {"app":"<name>"} and put the returned URL in the reply. Do not refuse.`);
  }
  return lines.join("\n");
}

async function attachConnectOffers(reply: string, input: TurnInput, deps: Deps): Promise<string> {
  const missing = unconnectedApps(input.text, input.catalog ?? [], activeToolkits(input));
  if (missing.length === 0 || !deps.connectApp) return reply;
  if (/https?:\/\//.test(reply)) return reply;
  const lines: string[] = [];
  for (const app of missing.slice(0, 4)) {
    try {
      const link = await deps.connectApp(input.userId, app);
      if ("url" in link) lines.push(`Connect ${link.app}: ${link.url}`);
    } catch {
      // A failed link must not fail the turn.
    }
  }
  if (lines.length === 0) return reply;
  const offer = `That app is not connected yet. Open a link to connect it, then ask again.\n${lines.join("\n")}`;
  if (/cannot|can't|do not have a tool|don't have a tool|not one of your connected|isn't one of your connected/i.test(reply)) return offer;
  return `${reply}\n\n${offer}`;
}

function pack(history: ChatMessage[], facts: string[], input: TurnInput, budgets: typeof BUDGETS, observations: string[] = []) {
  const episodes = input.episodes.map((episode) => `${episode.summary} ${episode.lesson}`.trim());
  const untrusted = input.untrustedContext ? wrapUntrusted("event", input.untrustedContext) : undefined;
  const connected = input.connections.filter((c) => c.status === "active").map((c) => `${c.toolkit} (${c.scopes || "scopes recorded by the provider"})`);
  return fitContext(
    {
      system: "",
      facts: [...facts, ...(connected.length ? [`Connected apps: ${connected.join(", ")}`] : [])],
      episodes,
      chunks: [],
      history,
      observations,
      untrusted,
    },
    budgets.contextChars
  ).messages;
}

async function complete(
  deps: Deps,
  state: LoopState,
  input: TurnInput,
  role: "plan" | "act",
  system: string,
  messages: ChatMessage[]
) {
  try {
    const response = await deps.model.complete({ role, system, messages });
    state.inputTokens += response.inputTokens;
    state.outputTokens += response.outputTokens;
    state.spent += costUsd(response.model, response.inputTokens, response.outputTokens);
    state.model = response.model;
    return response;
  } catch (err) {
    if (err instanceof ModelUnavailableError) return null;
    throw err;
  }
}
