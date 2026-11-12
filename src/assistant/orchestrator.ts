import { randomUUID } from "node:crypto";
import type { ApprovalRecord, ChatMessage, Checkpoint, Plan, Proposal, Quota, RunEvent, Span, StopReason, TraceEntry } from "./types";
import type { ModelClient } from "./types";
import type { AssistantStore } from "./builtin";
import type { ToolHub } from "./hub";
import { classifyEffect, gateDecision } from "./policy";
import { composeReply, redactForLog, redactSecrets, screenInput, screenOutput, wrapUntrusted } from "./filters";
import { selectTools, allowlist } from "./registry";
import { fitContext } from "./context";
import { retrieve } from "./memory";
import { parseAct, parsePlan } from "./planner";
import { actionDigest, canResolve } from "./approvals";
import { allowRate, allowSpend, costUsd } from "./cost";
import { createTracer } from "./trace";
import { canonical, clampText, idempotencyKey } from "./util";
import { ACT_INSTRUCTION, CATALOG_PLAN_INSTRUCTION, PLAN_INSTRUCTION, POLICY_SYSTEM } from "./prompts";
import { describeApproval, approvalTitle } from "./approval-copy";
import { isPlanApproval } from "./intent";
import { ambiguousToolkitGroups, describeHits, displayName, isWebSearchTool, parseCatalogDecision, proposalFromSteps, textNamesToolkit, toolkitLabels, toolkitOf, toolkitsMatchingName, unconnectedHitLabels, type CatalogAction, type PlanningState, type ToolkitName } from "./planning";
import { claimsNoTools, createAgentHref, ensureActionTools, helpfulFallback, looksLikeAgentBrief, nudgePlan, withConnectTool } from "./apps";
import { readSavedSteps, refreshKeysFromModel, workflowOffer, type WorkflowOffer, type WorkflowStep } from "./workflow";
import { ensureSearchTools, mentionsAppData, toolkitSlugFromTool } from "./composio-tools";
import { extensionDelegate, runResearch } from "./subagent";
import { ModelUnavailableError } from "./model-client";

const BUDGETS = {
  maxSteps: 8,
  maxTokens: 20_000,
  contextChars: 12_000,
  approvalTtlMs: 72 * 60 * 60 * 1000,
  maxIdentical: 2,
  innerLoops: 4,
  /** Leave time for the reply to flush before the platform kills the function. */
  deadlineMs: 45_000,
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
  ownerEmail?: string;
  /** Set only by the scheduler after the owner approved the routine. */
  preapprovedExternal?: boolean;
  pendingPlan?: Proposal | null;
  planning?: PlanningState | null;
  catalogActions?: CatalogAction[];
  /** Steps from a saved workflow. A scheduled run executes these instead of asking. */
  savedSteps?: WorkflowStep[];
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
  searchCatalog?: (queries: string[]) => Promise<CatalogAction[]>;
  /** Composio toolkit catalog lookup by the name the user said, not tool search. */
  lookupToolkits?: (name: string) => Promise<ToolkitName[]>;
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
  proposal: Proposal | null;
  question: { id: string; prompt: string; choices: string[]; required: boolean; allowSkip: boolean } | null;
  planning: PlanningState | null;
  builderHref: string | null;
  workflow: WorkflowOffer | null;
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
  const started = deps.now().getTime();
  const expired = () => deps.now().getTime() - started > budgets.deadlineMs;
  let proposal: Proposal | null = null;
  let question: RunResult["question"] = null;
  let planningState: PlanningState | null = input.planning ?? null;
  let builderHref: string | null = null;
  const stage = (name: string, text: string) => {
    tracer.span(name, { step: text.slice(0, 80) });
    emit({ type: "think", stage: name, text });
  };
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
    stage("output", "Checking the reply before I show it.");
    const offered = planningState || proposal?.mapped ? reply : await attachConnectOffers(reply, input, deps);
    if (!builderHref && (looksLikeAgentBrief(input.text) || looksLikeAgentBrief(planningState?.brief ?? ""))) {
      builderHref = createAgentHref(planningState?.brief || input.text);
      emit({ type: "builder", href: builderHref });
    }
    const safe = screenOutput(composeReply(offered, state.trace));
    const summary = safe.text.slice(0, 500);
    if (stopReason !== "INPUT_BLOCKED" && stopReason !== "RATE_LIMIT") {
      await deps.store.addEpisode(input.userId, {
        taskId: input.taskId,
        summary,
        lesson: `Stop ${stopReason}. Tools: ${state.trace.map((t) => t.tool).join(", ") || "none"}.`,
      });
    }
    stage("memory", "Saving this turn.");
    await deps.store.audit(input.userId, "turn_finished", stopReason, state.trace.map((entry) => approvalTitle(entry.tool)).join(", ") || "no tools");
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
      proposal,
      question,
      planning: planningState,
      builderHref,
      workflow: await annotateRefresh(
        workflowOffer({
          request: planningState?.brief || input.text,
          trace: state.trace,
          proposal,
        }),
        input,
        deps,
        state
      ),
    };
  };

  if (input.resume) return resume(input, deps, budgets, state, finish, emit);

  stage("input", "Checking this message against the safety rules.");
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

  const savedSteps = input.savedSteps?.length ? input.savedSteps : input.trigger === "schedule" ? readSavedSteps(input.text) : [];
  if (input.trigger === "schedule" && savedSteps.length) {
    stage("planner", "Running the saved steps directly.");
    return replaySavedSteps(savedSteps, input, deps, budgets, state, emit, finish);
  }

  stage("context", "Reading recent chat, saved notes, and past tasks.");
  const factHits = retrieve(input.text, input.facts, { userId: input.userId, limit: 5 });
  const chunkHits = retrieve(input.text, input.chunks, { userId: input.userId, limit: 4 });
  const history = [...input.history, { role: "user" as const, content: input.text }];
  const memoryNotes = [...factHits.map((fact) => fact.text), ...chunkHits.slice(0, 3).map((chunk) => chunk.text.slice(0, 500))];
  const setters = {
    setPlanning: (next: PlanningState) => {
      planningState = next;
    },
    setQuestion: (next: RunResult["question"]) => {
      question = next;
    },
  };
  if (input.planning?.question?.id === "missing-args" && input.planning.proposal?.mapped && input.text.trim()) {
    stage("planner", "Using your answer, then running the approved plan.");
    return runMappedPlan(input.planning.proposal, input, deps, state, emit, finish, setters);
  }
  if (input.planning?.status === "ready" && input.planning.proposal?.mapped && isPlanApproval(input.text)) {
    stage("planner", "You approved the plan. I'll run the mapped actions, not a web search.");
    return runMappedPlan(input.planning.proposal, input, deps, state, emit, finish, setters);
  }

  const catalogOutcome = await catalogRounds(input, deps, state, memoryNotes, history, emit, stage, finish, (next) => {
    planningState = next;
  }, (next) => {
    question = next;
  }, (next) => {
    proposal = next;
  });
  if (catalogOutcome.done) return catalogOutcome.result;

  stage("planner", "This is specific enough to act on.");
  let planResult: ReturnType<typeof parsePlan> | null = catalogOutcome.plan ? { ok: true, plan: catalogOutcome.plan } : null;
  let planError = "empty";
  for (let attempt = 0; attempt < 2 && (!planResult || !planResult.ok); attempt++) {
    const response = await complete(deps, state, input, "plan", `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${PLAN_INSTRUCTION}`, pack(history, memoryNotes, input, budgets), emit);
    if (!response) return finish("MODEL_UNAVAILABLE", "The model provider is not configured or is unavailable.", null, null);
    planResult = parsePlan(response.text);
    if (!planResult.ok) {
      planError = planResult.error;
      console.error("[assistant] plan_rejected", planError, "chars", response.text.length, "snippet", redactForLog(response.text).slice(0, 160));
    }
  }
  if (!planResult || !planResult.ok) {
    const recovered = await recoverFromPlanFailure(deps, state, input, history, memoryNotes, emit);
    return finish("MODEL_ANSWER", recovered, null, null);
  }
  const plan = nudgePlan(planResult.plan, input);
  tracer.span("plan", { intent: plan.intent, steps: plan.steps.length });

  if (plan.intent === "answer_from_docs" && chunkHits.length === 0) {
    return finish("ABSTAIN", "I don't have a document that answers that. Upload the file or connect the app that has it.", null, null);
  }

  if (plan.intent === "chat" || plan.intent === "answer_from_docs") {
    const system = `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${ACT_INSTRUCTION}\nNo tools on this turn. Put the reply in JSON and cite document ids when you use them.`;
    const response = await complete(deps, state, input, "act", system, pack(history, [...memoryNotes, ...chunkHits.map((c) => `${c.id}: ${c.text}`)], input, budgets), emit);
    if (!response) return finish("MODEL_UNAVAILABLE", "The model provider is not configured or is unavailable.", null, null);
    const act = parseAct(response.text);
    const reply = act.ok ? act.act.reply : response.text;
    if (plan.intent === "answer_from_docs" && !chunkHits.some((chunk) => reply.includes(chunk.id))) {
      return finish("ABSTAIN", "I found documents but couldn't ground an answer in them.", null, null);
    }
    return finish("MODEL_ANSWER", reply || plan.success, null, null);
  }

  for (let index = 0; index < plan.steps.length; index++) {
    if (expired()) return finish("MODEL_ANSWER", "I stopped so this answer could reach you. Ask me to continue the rest.", snapshot(plan, index, state), null);
    stage("react", `Working through step ${index + 1}: ${plan.steps[index].goal}`);
    const stepResult = await runStep(plan, index, input, deps, budgets, state, memoryNotes, history, emit, started + budgets.deadlineMs);
    if (stepResult) return finish(stepResult.stopReason, stepResult.reply, stepResult.checkpoint, stepResult.approval);
  }

  const reply = state.observations.filter((line) => !line.startsWith("<untrusted")).at(-1) || plan.success;
  return finish("MODEL_ANSWER", reply, null, null);
}

function appNames(input: TurnInput): string[] {
  return [
    ...input.connections.map((connection) => connection.toolkit),
    ...(input.catalogActions ?? []).flatMap((action) => [action.toolkitName ?? "", action.toolkit ?? "", toolkitOf(action.slug)]),
  ].filter(Boolean);
}

function connectedTo(input: TurnInput, toolkit: string): boolean {
  const id = toolkit.toLowerCase().replace(/[\s_-]+/g, "");
  return input.connections.some((connection) => connection.status === "active" && connection.toolkit.toLowerCase().replace(/[\s_-]+/g, "") === id);
}

const NEEDS_ATTENTION = "This run needs attention.";

function parseArgObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.action === "ask" || record.action === "search" || record.action === "propose") return null;
    return record;
  } catch {
    return null;
  }
}

async function confirmSavedTool(input: TurnInput, deps: Deps, step: WorkflowStep): Promise<CatalogAction | null> {
  const known = (input.catalogActions ?? []).find((action) => action.slug === step.tool) ?? null;
  if (!deps.searchCatalog) return known;
  const live = await deps.searchCatalog([step.goal, step.toolkit, step.tool].filter(Boolean).slice(0, 4)).catch(() => []);
  return live.find((action) => action.slug === step.tool) ?? null;
}

function hasArg(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

type ArgFill = { args: Record<string, unknown>; ask: string[] };

function parseFill(text: string): ArgFill | null {
  const record = parseArgObject(text);
  if (!record) return null;
  const ask = Array.isArray(record.ask) ? record.ask.filter((key): key is string => typeof key === "string" && key.trim().length > 0) : [];
  if (record.args && typeof record.args === "object" && !Array.isArray(record.args)) {
    return { args: record.args as Record<string, unknown>, ask };
  }
  const args = { ...record };
  delete args.ask;
  delete args.args;
  return { args, ask };
}

/** One argument fill for a saved replay and for an approved chat plan. */
async function resolveStepArgs(
  spec: { tool: string; goal: string; args: Record<string, unknown>; refresh: string[]; action: CatalogAction; request: string; prior: string },
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void
): Promise<ArgFill | null> {
  const args = { ...spec.args };
  const required = spec.action.required ?? [];
  const missing = required.filter((key) => !hasArg(args[key]));
  const needsModel = spec.refresh.length > 0 || missing.length > 0 || Object.keys(args).length === 0 || Boolean(spec.prior);
  if (!needsModel) return { args, ask: [] };
  const context = [spec.request, input.text, ...input.history.slice(-4).map((message) => `${message.role}: ${message.content.slice(0, 240)}`)]
    .filter(Boolean)
    .join("\n");
  const response = await complete(
    deps,
    state,
    input,
    "act",
    [
      "Fill the arguments for one workflow step.",
      'Reply with one JSON object: {"args":{...},"ask":["keys only the user knows"]}. A flat argument object is also fine. Do not ask a question in prose.',
      `Request and conversation:\n${context}`,
      `Tool: ${spec.tool}`,
      `Goal: ${spec.goal}`,
      spec.action.schemaHint ? `Composio argument schema: ${spec.action.schemaHint}` : "",
      required.length ? `Required parameters: ${required.join(", ")}.` : "",
      spec.refresh.length ? `Choose fresh values for: ${spec.refresh.join(", ")}.` : "",
      `Known values: ${JSON.stringify(args)}`,
      spec.prior ? `Earlier step results:\n${spec.prior}` : "No earlier step has run yet. Do not ask for a value a later listed step will produce.",
      "Use earlier step results in later arguments, such as a link or id.",
      "Put a key in ask only when it is a user-specific value you cannot infer, such as which chat or recipient. Do not ask for flags you can default.",
    ].filter(Boolean).join("\n"),
    [{ role: "user", content: input.text }],
    emit
  );
  const filled = response ? parseFill(response.text) : null;
  if (!filled) return missing.length || spec.refresh.length ? null : { args, ask: [] };
  const merged = { ...args, ...filled.args };
  const stillMissing = required.filter((key) => !hasArg(merged[key]));
  const refreshMissing = spec.refresh.some((key) => !hasArg(merged[key]));
  if (refreshMissing || (stillMissing.length && filled.ask.length === 0)) return null;
  return { args: merged, ask: filled.ask };
}

async function resolveSavedArgs(
  step: WorkflowStep,
  action: CatalogAction,
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void
): Promise<Record<string, unknown> | null> {
  const filled = await resolveStepArgs(
    { tool: step.tool, goal: step.goal, args: step.args, refresh: step.refresh, action, request: input.text, prior: "" },
    input,
    deps,
    state,
    emit
  );
  if (!filled || filled.ask.length) return null;
  return filled.args;
}

function mentionedNames(text: string): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as { names?: unknown };
    if (!Array.isArray(value.names)) return [];
    return [...new Set(value.names.map((item) => String(item).trim()).filter((item) => item.length >= 2))].slice(0, 6);
  } catch {
    return [];
  }
}

function quotedEvidence(evidence: string, action: CatalogAction | undefined): boolean {
  const quote = evidence.trim();
  if (quote.length < 8) return false;
  const haystack = `${action?.description ?? ""}\n${action?.outputHint ?? ""}`;
  return haystack.includes(quote);
}

/** True only when the user wants a new file made from a description. Fetching, summarising, or sending what already exists is not that. */
async function wantsNewArtifact(
  brief: string,
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void
): Promise<boolean> {
  const response = await complete(
    deps,
    state,
    input,
    "plan",
    [
      "Does the user want a new artifact created from a description, such as a video, image, or file?",
      "Fetching, summarising, listing, or sending something that already exists is not creating a new artifact.",
      `Request: ${brief}`,
      'Reply JSON {"create":true|false}.',
    ].join("\n"),
    [{ role: "user", content: brief }],
    emit
  );
  if (!response) return false;
  const start = response.text.indexOf("{");
  const end = response.text.lastIndexOf("}");
  if (start < 0 || end <= start) return false;
  try {
    const value = JSON.parse(response.text.slice(start, end + 1)) as { create?: unknown };
    return value.create === true;
  } catch {
    return false;
  }
}

/** Strong-model check. A step counts only when its verdict quotes the description or output schema. */
async function stepsMatchOutput(
  mapped: { tool: string; goal: string }[],
  found: CatalogAction[],
  brief: string,
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void
): Promise<{ ok: boolean; rejection: string }> {
  const lines = mapped.map((step) => {
    const action = found.find((item) => item.slug === step.tool);
    return [`Tool ${step.tool}`, `Description: ${action?.description || step.goal}`, `Output schema: ${action?.outputHint || "(none)"}`].join("\n");
  });
  const response = await complete(
    deps,
    state,
    input,
    "plan",
    [
      "Check whether these steps produce the requested output.",
      "For each step answer: Does this step create the requested artifact from the user's description, as opposed to uploading, exporting or converting existing content?",
      "Read the full description and output schema.",
      `Original request: ${brief}`,
      "Steps:",
      lines.join("\n\n"),
      'Reply JSON {"steps":[{"tool":"SLUG","produces":true|false,"evidence":"a quote copied from that step description or output schema"}]}.',
      "produces is true only when the quoted evidence shows the step creates that artifact from the description.",
      "Uploading, exporting, or converting something that already exists is not creating it. If you cannot quote the evidence, produces is false and evidence is empty.",
    ].join("\n"),
    [{ role: "user", content: brief }],
    emit
  );
  if (!response) return { ok: false, rejection: "The output check did not answer." };
  const start = response.text.indexOf("{");
  const end = response.text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, rejection: "The output check was not a verdict." };
  try {
    const value = JSON.parse(response.text.slice(start, end + 1)) as { steps?: unknown };
    if (!Array.isArray(value.steps)) return { ok: true, rejection: "" };
    const verdicts = value.steps.filter((item) => item && typeof item === "object" && "produces" in item);
    if (!verdicts.length) return { ok: true, rejection: "" };
    const qualified = verdicts.filter((item) => {
      const verdict = item && typeof item === "object" ? (item as { tool?: unknown; produces?: unknown; evidence?: unknown }) : {};
      const action = found.find((entry) => entry.slug === verdict.tool);
      return verdict.produces === true && typeof verdict.evidence === "string" && quotedEvidence(verdict.evidence, action);
    });
    if (qualified.length) return { ok: true, rejection: "" };
    return { ok: false, rejection: "No step's description or output schema shows that it produces what was asked for." };
  } catch {
    return { ok: false, rejection: "The output check was not a verdict." };
  }
}

async function missingSubtasks(
  mapped: { tool: string; goal: string }[],
  found: CatalogAction[],
  brief: string,
  answer: string,
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void
): Promise<string[]> {
  const lines = mapped.map((step) => {
    const action = found.find((item) => item.slug === step.tool);
    return `${step.tool}: ${action?.description || step.goal}`;
  });
  const response = await complete(
    deps,
    state,
    input,
    "plan",
    [
      "The latest message only chooses an app. It does not remove any other part of the original request.",
      `Original request: ${brief}`,
      `App choice: ${answer}`,
      "Proposed steps:",
      lines.join("\n"),
      'Reply JSON {"missing":["parts of the original request that no step covers"]}. Use [] when every part is covered.',
    ].join("\n"),
    [{ role: "user", content: brief }],
    emit
  );
  if (!response) return [];
  const start = response.text.indexOf("{");
  const end = response.text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const value = JSON.parse(response.text.slice(start, end + 1)) as { missing?: unknown };
    if (!Array.isArray(value.missing)) return [];
    return value.missing.map((item) => String(item).trim()).filter(Boolean).slice(0, 4);
  } catch {
    return [];
  }
}

async function annotateRefresh(offer: WorkflowOffer | null, input: TurnInput, deps: Deps, state: LoopState): Promise<WorkflowOffer | null> {
  if (!offer || input.trigger !== "chat" || !offer.steps.some((step) => Object.keys(step.args).length)) return offer;
  const lines = offer.steps.map((step) => `${step.tool}: ${JSON.stringify(step.args)}`).join("\n");
  const response = await complete(
    deps,
    state,
    input,
    "act",
    `Which argument values should be chosen again the next time this workflow runs?\nReply JSON only: {"refresh":["key"]}.\nInclude a key when the value is a date, the latest item, or anything that should change next run. Leave out stable flags and ids.\nRequest: ${offer.request}\n${lines}`,
    [{ role: "user", content: offer.request }],
    () => {}
  );
  const marks = response ? refreshKeysFromModel(response.text) : null;
  if (!marks?.length) return offer;
  return {
    ...offer,
    steps: offer.steps.map((step) => ({
      ...step,
      refresh: [...new Set([...step.refresh, ...marks.filter((key) => Object.prototype.hasOwnProperty.call(step.args, key))])],
    })),
  };
}

function planFromSaved(steps: WorkflowStep[], request: string): Plan {
  return {
    intent: "act",
    success: request,
    steps: steps.map((step, index) => ({ id: `saved-${index + 1}`, goal: step.goal, toolQuery: step.tool, tool: step.tool })),
  };
}

/** Scheduled and Run now turns execute the saved steps. They never ask the owner a question. */
async function replaySavedSteps(
  steps: WorkflowStep[],
  input: TurnInput,
  deps: Deps,
  budgets: typeof BUDGETS,
  state: LoopState,
  emit: (event: RunEvent) => void,
  finish: (stop: StopReason, reply: string, checkpoint: Checkpoint | null, approval: RunResult["approval"]) => Promise<RunResult>
): Promise<RunResult> {
  const plan = planFromSaved(steps, input.text);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const confirmed = await confirmSavedTool(input, deps, step);
    if (!confirmed) {
      return finish("FAILED", `${NEEDS_ATTENTION} I couldn't confirm ${step.tool} in the catalog, so I stopped without asking.`, null, null);
    }
    const args = await resolveSavedArgs(step, confirmed, input, deps, state, emit);
    if (!args) {
      const missing = step.refresh.length ? step.refresh.join(", ") : "its arguments";
      return finish("FAILED", `${NEEDS_ATTENTION} I couldn't fill in ${missing} for ${step.tool}, so I stopped without asking.`, null, null);
    }
    const gate = gateDecision(step.tool);
    if (gate.decision === "deny") {
      return finish("FAILED", `${NEEDS_ATTENTION} ${step.tool} isn't allowed, so I stopped without asking.`, null, null);
    }
    const key = idempotencyKey([input.userId, input.conversationId, step.tool, args, index]);
    if (gate.decision === "hold" && !input.preapprovedExternal) {
      const approvalId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + budgets.approvalTtlMs).toISOString();
      const digest = actionDigest(step.tool, args);
      await deps.store.createApproval({
        id: approvalId,
        userId: input.userId,
        taskId: input.taskId,
        tool: step.tool,
        args,
        digest,
        expiresAt,
        idempotencyKey: key,
      });
      await deps.store.audit(input.userId, "approval_requested", step.tool, digest);
      state.trace.push({ tool: step.tool, args, effect: gate.effect, ok: false, queued: true });
      emit({ type: "approval", approval: { id: approvalId, tool: step.tool, args, expiresAt } });
      const checkpoint = snapshot(plan, index + 1, state);
      checkpoint.held = { approvalId, stepIndex: index, tool: step.tool, args, idempotencyKey: key };
      return finish("WAITING_APPROVAL", describeApproval(step.tool, args, { text: step.goal, ownerEmail: input.ownerEmail }), checkpoint, {
        id: approvalId,
        tool: step.tool,
        args,
        expiresAt,
      });
    }
    emit({ type: "think", stage: "tool", text: `Working on ${approvalTitle(step.tool)}.` });
    const result = await deps.hub.call(input.userId, step.tool, { ...args, idempotencyKey: key }, new Set([step.tool]));
    state.toolCalls += 1;
    state.trace.push({ tool: step.tool, args, effect: gate.effect, ok: result.ok, ...(result.ok ? {} : { error: result.error?.message }) });
    await deps.store.audit(input.userId, result.ok ? "tool_executed" : "tool_failed", step.tool, result.ok ? "ok" : result.error?.code ?? "failed");
    if (!result.ok) {
      return finish("FAILED", `${NEEDS_ATTENTION} ${step.tool} failed${result.error?.message ? `: ${result.error.message}` : "."}`, snapshot(plan, index, state), null);
    }
    state.observations.push(wrapUntrusted(step.tool, clampText(JSON.stringify(result), 1200).text));
  }
  const reply = state.observations.filter((line) => !line.startsWith("<untrusted")).at(-1) || "The saved workflow ran.";
  return finish("MODEL_ANSWER", reply, null, null);
}

async function catalogRounds(
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  memoryNotes: string[],
  history: ChatMessage[],
  emit: (event: RunEvent) => void,
  stage: (name: string, text: string) => void,
  finish: (stop: StopReason, reply: string, checkpoint: Checkpoint | null, approval: RunResult["approval"]) => Promise<RunResult>,
  setPlanning: (next: PlanningState) => void,
  setQuestion: (next: RunResult["question"]) => void,
  setProposal: (next: Proposal | null) => void
): Promise<{ done: true; result: RunResult } | { done: false; plan?: Plan }> {
  const brief = input.planning?.brief || input.text;
  let notes = input.planning?.notes ?? "";
  const found: CatalogAction[] = [];
  const seen = new Set<string>();
  const remember = (actions: CatalogAction[]) => {
    for (const action of actions) {
      if (seen.has(action.slug)) continue;
      seen.add(action.slug);
      found.push(action);
    }
  };
  remember(input.catalogActions ?? []);
  remember(input.planning?.candidates ?? []);
  remember([
    { slug: "builtin.routines.create", toolkit: "builtin", toolkitName: "Scheduler", description: "Create a recurring routine for every day, once a day, hourly, or weekly." },
    { slug: "builtin.web.search", toolkit: "builtin", toolkitName: "Web", description: "Search the public web for facts the user asked for." },
    { slug: "builtin.apps.connect", toolkit: "builtin", toolkitName: "Connections", description: "Return a connect link for an app that is not connected." },
  ]);
  let catalogHits = (input.planning?.candidates ?? []).filter((action) => !action.slug.startsWith("builtin.")).length;
  let outputReproposes = 0;
  let coverageReproposes = 0;
  const asked = new Set(String(input.planning?.answers.asked ?? "").split("||").filter(Boolean));
  const snapshot = (extra: Partial<PlanningState>): PlanningState => ({
    brief,
    answers: extra.answers ?? input.planning?.answers ?? {},
    status: extra.status ?? "asking",
    question: extra.question ?? null,
    proposal: extra.proposal ?? null,
    notes,
    candidates: found.filter((action) => !action.slug.startsWith("builtin.")).slice(0, 240),
  });
  const chipLabels = () => toolkitLabels(found.filter((action) => !action.slug.startsWith("builtin.")));
  if (!notes) {
    notes = "Search before you name an app. builtin.routines.create is only for a schedule the user asked to repeat. Do not propose builtin.apps.connect; an unconnected catalog action shows a Connect button.";
  }
  const named = await resolveNamedToolkits();
  if (named) return named;
  const rounds = 5;
  for (let round = 0; round < rounds; round++) {
    const response = await complete(
      deps,
      state,
      input,
      "plan",
      `${POLICY_SYSTEM}\n${CATALOG_PLAN_INSTRUCTION}\n${notes}${input.planning?.question ? `\nPrevious question: ${input.planning.question.prompt}` : ""}`,
      pack(history, memoryNotes, input, { ...BUDGETS, ...deps.budgets }),
      emit
    );
    if (!response) return { done: true, result: await finish("MODEL_UNAVAILABLE", "The model provider is not configured or is unavailable.", null, null) };
    const decision = parseCatalogDecision(response.text);
    if (decision.reasoning) stage("reasoning", decision.reasoning.replace(/\s+/g, " ").slice(0, 240));
    if (decision.kind === "direct") {
      const catalogTools = decision.plan.steps.filter((step) => step.tool && !step.tool.startsWith("builtin."));
      if (catalogTools.length && input.trigger !== "schedule" && (await wantsNewArtifact(brief, input, deps, state, emit))) {
        const fits = await stepsMatchOutput(
          catalogTools.map((step) => ({ tool: step.tool as string, goal: step.goal })),
          found,
          brief,
          input,
          deps,
          state,
          emit
        );
        if (!fits.ok) {
          notes += "\nThat plan's steps do not produce what the user asked for. Propose catalog actions whose descriptions match the request.";
          continue;
        }
      }
      return { done: false, plan: decision.plan };
    }
    if (decision.kind === "search") {
      const queries = [...decision.queries, ...decision.capabilities, decision.toolkits.join(" ")].map((query) => query.trim()).filter(Boolean);
      const askedQueries = (queries.length ? queries : [brief]).slice(0, 4);
      const live = deps.searchCatalog ? await deps.searchCatalog(askedQueries).catch(() => []) : input.catalogActions ?? [];
      const added = live.filter((action) => !seen.has(action.slug) && !action.slug.startsWith("builtin."));
      catalogHits += added.length;
      remember(added);
      const catalog = found.filter((action) => !action.slug.startsWith("builtin."));
      notes = `${describeHits(catalog, input.connections)}\nPick the slug whose description matches the output the user asked for. Do not propose builtin.apps.connect. Use a routine only when the user asked for a repeated schedule.`;
      const labels = toolkitLabels(added.length ? added : catalog);
      const ambiguous = ambiguousToolkitGroups(brief, catalog);
      if (catalogHits === 0 && !catalog.length) notes += "\nNo catalog app matched. Use a built-in action or a direct act plan if one of those does the job.";
      else if (ambiguous.length) notes += `\nThese toolkits could match the same word: ${ambiguous.map((group) => group.join(" or ")).join("; ")}. Ask which one before you propose.`;
      else if (labels.length > 1) notes += `\nComposio returned these toolkits, in its order: ${labels.join(", ")}.`;
      notes += "\nThe searches for this turn already ran in parallel. Propose or ask from these actions now.";
      stage("planner", `Searched Composio for ${askedQueries.join(" / ")} and found ${catalog.length} actions.`);
      if (round === rounds - 1) return askOrProposeFromHits();
      continue;
    }
    if (decision.kind === "ask") {
      if (input.trigger === "schedule") {
        return { done: true, result: await finish("FAILED", `${NEEDS_ATTENTION} A background run can't ask a question.`, null, null) };
      }
      const answered = Boolean(input.planning?.question) && input.text.trim().length > 0;
      if (asked.has(decision.question.prompt) || answered) {
        const forced = stepsAfterAnswer(found, input.text, input.planning?.question?.prompt ?? decision.question.prompt);
        if (forced.length) return deliverMapped(forced);
        notes += `\nThe user already answered "${input.text}". Do not ask again. Propose now and use that answer as the default, or use a list action from the catalog results.`;
        continue;
      }
      const labels = chipLabels();
      const choices = decision.question.choices.length ? decision.question.choices : decision.choicesOmitted && labels.length ? labels : [];
      const question = { ...decision.question, choices };
      asked.add(question.prompt);
      const planning = snapshot({
        answers: { ...(input.planning?.answers ?? {}), latest: input.planning ? input.text : "", asked: [...asked].join("||") },
        status: "asking",
        question,
        proposal: null,
      });
      setPlanning(planning);
      setQuestion(question);
      emit({ type: "question", question });
      return { done: true, result: await finish("MODEL_ANSWER", question.prompt, null, null) };
    }
    if (decision.kind === "propose") {
      const picked = input.planning ? input.text : "";
      const unresolved = ambiguousToolkitGroups(brief, found).filter((group) => group.filter((label) => textNamesToolkit(picked, label)).length !== 1);
      if (unresolved.length) {
        if (input.trigger === "schedule") {
          return { done: true, result: await finish("FAILED", `${NEEDS_ATTENTION} A background run can't ask which app you meant.`, null, null) };
        }
        const question = { id: "which-toolkit", prompt: `Which did you mean: ${unresolved[0].join(" or ")}?`, choices: unresolved[0], required: true, allowSkip: false };
        setPlanning(snapshot({ answers: { ...(input.planning?.answers ?? {}), asked: [...asked, question.prompt].join("||") }, status: "asking", question, proposal: null }));
        setQuestion(question);
        emit({ type: "question", question });
        return { done: true, result: await finish("MODEL_ANSWER", question.prompt, null, null) };
      }
      const mapped = [];
      let missingSlug = false;
      for (const step of decision.steps) {
        const action = found.find((item) => item.slug === step.tool);
        if (!action) {
          missingSlug = true;
          break;
        }
        const toolkit = action.toolkit || toolkitOf(action.slug);
        mapped.push({
          goal: step.goal || (action.description ?? "").replace(/\s+/g, " ").slice(0, 180) || action.slug,
          tool: action.slug,
          toolkit,
          app: displayName(action),
          connected: action.slug.startsWith("builtin.") || (typeof action.connected === "boolean" ? action.connected : connectedTo(input, toolkit)),
          ...(action.connectUrl ? { connectUrl: action.connectUrl } : {}),
        });
      }
      if (missingSlug || !mapped.length) {
        notes += "\nEvery step tool must be an exact slug from the catalog results, including its description.";
        continue;
      }
      if (!mapped.some((step) => !step.tool.startsWith("builtin.")) && mapped.every((step) => step.tool === "builtin.apps.connect")) {
        notes += "\nDo not propose connecting as the plan. Propose the catalog actions. Unconnected ones already get a Connect button.";
        continue;
      }
      if (mapped.some((step) => step.tool === "builtin.routines.create") && !asksForRecurrence(brief)) {
        notes += "\nThe user did not ask for a repeated schedule. Do not use builtin.routines.create. Propose the catalog actions for this request.";
        continue;
      }
      if (await wantsNewArtifact(brief, input, deps, state, emit)) {
        const fits = await stepsMatchOutput(mapped, found, brief, input, deps, state, emit);
        if (!fits.ok && outputReproposes < 2) {
          outputReproposes += 1;
          notes += `\n${fits.rejection} Propose once more and keep every part of the request. Use actions that create the artifact from the description, not ones that only upload, export, or convert something that already exists.`;
          continue;
        }
      }
      if (input.planning && input.text.trim() && input.text.trim() !== brief.trim()) {
        const missing = await missingSubtasks(mapped, found, brief, input.text, input, deps, state, emit);
        if (missing.length && coverageReproposes < 2) {
          coverageReproposes += 1;
          notes += `\nThe answer "${input.text}" only chooses an app. The original request still needs: ${missing.join("; ")}. Propose again and include every part.`;
          continue;
        }
      }
      return deliverMapped(mapped, decision.understanding);
    }
    notes += "\nThat was not usable JSON. Return one JSON object: action search, ask, propose, or a direct plan.";
  }
  return askOrProposeFromHits();

  async function resolveNamedToolkits(): Promise<{ done: true; result: RunResult } | null> {
    if (input.trigger === "schedule" || !deps.lookupToolkits) return null;
    const response = await complete(
      deps,
      state,
      input,
      "plan",
      `List the app or service names the user mentioned.\nReply JSON {"names":["the names in their words"]}.\nDo not invent apps. If they named none, return {"names":[]}.\nRequest: ${brief}`,
      [{ role: "user", content: brief }],
      emit
    );
    const names = response ? mentionedNames(response.text) : [];
    const answer = input.planning ? input.text : "";
    for (const name of names) {
      const listed = await deps.lookupToolkits(name).catch(() => []);
      const matches = toolkitsMatchingName(name, listed);
      if (matches.length < 2) continue;
      const choices = matches.map((toolkit) => toolkit.name);
      if (answer.trim() && choices.filter((label) => textNamesToolkit(answer, label)).length === 1) continue;
      const question = { id: "which-toolkit", prompt: `Which did you mean: ${choices.join(" or ")}?`, choices, required: true, allowSkip: false };
      if (asked.has(question.prompt)) continue;
      asked.add(question.prompt);
      setPlanning(snapshot({ answers: { ...(input.planning?.answers ?? {}), asked: [...asked].join("||") }, status: "asking", question, proposal: null }));
      setQuestion(question);
      emit({ type: "question", question });
      return { done: true, result: await finish("MODEL_ANSWER", question.prompt, null, null) };
    }
    return null;
  }

  async function deliverMapped(mapped: { goal: string; tool: string; toolkit: string; app: string; connected: boolean; connectUrl?: string }[], understanding?: string) {
    const catalogSteps = mapped.filter((step) => !step.tool.startsWith("builtin."));
    let next = proposalFromSteps(understanding || decisionUnderstanding(mapped), mapped);
    if (mapped.every((step) => step.tool === "builtin.routines.create") && asksForRecurrence(brief)) {
      return { done: true as const, result: await runMappedPlan(next, input, deps, state, emit, finish, { setPlanning, setQuestion }) };
    }
    const readyToAct =
      catalogSteps.length > 0 &&
      catalogSteps.every((step) => step.connected) &&
      (input.trigger === "schedule" || catalogSteps.every((step) => gateDecision(step.tool).decision !== "hold"));
    if (readyToAct) {
      return {
        done: false as const,
        plan: {
          intent: "act" as const,
          success: understanding || brief,
          steps: catalogSteps.map((step, index) => ({ id: `s${index + 1}`, goal: step.goal, toolQuery: step.tool, tool: step.tool })),
        },
      };
    }
    if (input.trigger === "schedule") {
      return { done: true as const, result: await finish("FAILED", `${NEEDS_ATTENTION} A background run can't stop on a plan.`, null, null) };
    }
    next = await attachStepLinks(next, input, deps);
    const planning = snapshot({ answers: input.planning?.answers ?? {}, status: "ready", question: null, proposal: next });
    setPlanning(planning);
    setProposal(next);
    emit({ type: "plan", proposal: next });
    return { done: true as const, result: await finish("MODEL_ANSWER", next.understanding || "Here is a plan from the catalog.", null, null) };
  }

  function decisionUnderstanding(mapped: { goal: string }[]): string {
    return mapped.map((step) => step.goal).join(" ").slice(0, 240) || brief;
  }

  function askOrProposeFromHits() {
    if (input.trigger === "schedule") {
      return finish("FAILED", `${NEEDS_ATTENTION} A background run can't ask a question, and the saved steps did not run.`, null, null).then((result) => ({ done: true as const, result }));
    }
    const catalogOnly = found.filter((action) => !action.slug.startsWith("builtin."));
    if (!catalogOnly.length) {
      return finish("MODEL_ANSWER", "I couldn't match that to the catalog. Name the app or describe the result in fewer words and I'll look again.", null, null).then((result) => ({ done: true as const, result }));
    }
    const ambiguous = ambiguousToolkitGroups(brief, catalogOnly);
    const labels = ambiguous[0] ?? chipLabels();
    const described = catalogOnly.slice(0, 6).map((action) => `${displayName(action)}: ${(action.description || action.slug).replace(/\s+/g, " ").slice(0, 120)}`);
    const question = {
      id: "from-hits",
      prompt: described.join("\n"),
      choices: labels,
      required: true,
      allowSkip: false,
    };
    setPlanning(snapshot({ answers: { ...(input.planning?.answers ?? {}), asked: [...asked, question.prompt].join("||") }, status: "asking", question, proposal: null }));
    setQuestion(question);
    emit({ type: "question", question });
    return finish("MODEL_ANSWER", question.prompt, null, null).then((result) => ({ done: true as const, result }));
  }
}

function stepsAfterAnswer(actions: CatalogAction[], answer: string, question: string) {
  const catalog = actions.filter((action) => !action.slug.startsWith("builtin."));
  const skip = new Set(["which", "should", "would", "could", "please", "where", "these", "those", "about", "there", "their", "using"]);
  const nouns = question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4 && !skip.has(word));
  const describes = (action: CatalogAction) => `${action.slug} ${action.description ?? ""}`.toLowerCase();
  const lister = catalog.find((action) => /LIST|GET_|FETCH|SEARCH/.test(action.slug) && nouns.some((noun) => describes(action).includes(noun)));
  const writers = catalog.filter((action) => /CREATE|ADD|UPDATE|SEND|POST/.test(action.slug) && action !== lister);
  const chosen = [...(lister ? [lister] : []), ...writers].slice(0, 4);
  const use = chosen.length ? chosen : catalog.slice(0, 2);
  return use.map((action) => {
    const toolkit = action.toolkit || toolkitOf(action.slug);
    return {
      goal: `${(action.description || action.slug).replace(/\s+/g, " ").slice(0, 160)}. Default from the user: ${answer}`,
      tool: action.slug,
      toolkit,
      app: displayName(action),
      connected: action.slug.startsWith("builtin.") || action.connected === true,
      ...(action.connectUrl ? { connectUrl: action.connectUrl } : {}),
    };
  });
}

function asksForRecurrence(text: string): boolean {
  return /\b(every day|each day|once a day|daily|hourly|every hour|weekly|every week|each morning|recurring)\b/i.test(text);
}

function countSearchHits(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const record = data as { results?: unknown; organic?: unknown; items?: unknown };
    for (const key of [record.results, record.organic, record.items]) {
      if (Array.isArray(key)) return key.length;
    }
  }
  return 0;
}

async function attachStepLinks(proposal: Proposal, input: TurnInput, deps: Deps): Promise<Proposal> {
  if (!proposal.mapped) return proposal;
  const mapped = [];
  for (const step of proposal.mapped) {
    if (step.connected || step.connectUrl || !deps.connectApp) {
      mapped.push(step);
      continue;
    }
    try {
      const link = await deps.connectApp(input.userId, step.app);
      mapped.push("url" in link ? { ...step, connectUrl: link.url } : step);
    } catch {
      mapped.push(step);
    }
  }
  return { ...proposal, mapped };
}

async function runMappedPlan(
  proposal: Proposal,
  input: TurnInput,
  deps: Deps,
  state: LoopState,
  emit: (event: RunEvent) => void,
  finish: (stop: StopReason, reply: string, checkpoint: Checkpoint | null, approval: RunResult["approval"]) => Promise<RunResult>,
  setters: { setPlanning: (next: PlanningState) => void; setQuestion: (next: RunResult["question"]) => void }
): Promise<RunResult> {
  const steps = proposal.mapped ?? [];
  const request = input.planning?.brief || proposal.understanding;
  const answering = input.planning?.question?.id === "missing-args";
  const askFor = async (keys: string[]) => {
    const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    const question = {
      id: "missing-args",
      prompt: `Before I run this, which ${unique.join(" and ") || "value"} should I use?`,
      choices: [] as string[],
      required: true,
      allowSkip: false,
    };
    const planning: PlanningState = {
      brief: request,
      answers: { ...(input.planning?.answers ?? {}), missing: unique.join(",") },
      status: "asking",
      question,
      proposal,
      notes: input.planning?.notes,
      candidates: input.planning?.candidates,
    };
    setters.setPlanning(planning);
    setters.setQuestion(question);
    emit({ type: "question", question });
    return finish("MODEL_ANSWER", question.prompt, null, null);
  };
  const loadAction = async (step: NonNullable<Proposal["mapped"]>[number]) =>
    (await confirmSavedTool(input, deps, { toolkit: step.toolkit, tool: step.tool, goal: step.goal, args: {}, refresh: [] })) ?? {
      slug: step.tool,
      toolkit: step.toolkit,
      description: step.goal,
    };
  if (!answering) {
    const needed: string[] = [];
    const earlier: string[] = [];
    for (const step of steps) {
      if (!step.connected || step.tool === "builtin.routines.create") {
        earlier.push(`${step.tool}: ${step.goal}`);
        continue;
      }
      const action = await loadAction(step);
      const filled = await resolveStepArgs(
        {
          tool: step.tool,
          goal: step.goal,
          args: {},
          refresh: [],
          action,
          request,
          prior: earlier.length ? `Not run yet. Earlier steps: ${earlier.join("; ")}` : "",
        },
        input,
        deps,
        state,
        emit
      );
      if (filled?.ask.length) needed.push(...filled.ask);
      earlier.push(`${step.tool}: ${step.goal}`);
    }
    if (needed.length && input.trigger !== "schedule") return askFor(needed);
  }
  const lines: string[] = [];
  const links: string[] = [];
  const prior: string[] = [];
  for (const step of steps) {
    if (!step.connected) {
      let url = step.connectUrl;
      if (!url && deps.connectApp) {
        try {
          const link = await deps.connectApp(input.userId, step.app);
          if ("url" in link) url = link.url;
        } catch {
          // The step still reports the missing app.
        }
      }
      links.push(url ? `${step.app}: ${url}` : step.app);
      emit({ type: "think", stage: "tool", text: `${step.app} is not connected, so I did not run "${step.goal}".` });
      continue;
    }
    if (step.tool === "builtin.routines.create") {
      const args = { prompt: proposal.understanding };
      const approvalId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + BUDGETS.approvalTtlMs).toISOString();
      await deps.store.createApproval({
        id: approvalId,
        userId: input.userId,
        taskId: input.taskId,
        tool: step.tool,
        args,
        digest: actionDigest(step.tool, args),
        expiresAt,
        idempotencyKey: idempotencyKey([input.userId, step.tool, proposal.understanding]),
      });
      emit({ type: "approval", approval: { id: approvalId, tool: step.tool, args, expiresAt } });
      return finish("WAITING_APPROVAL", describeApproval(step.tool, { cadence: "daily", prompt: step.goal || proposal.understanding, name: step.app }, { text: step.goal || proposal.understanding, ownerEmail: input.ownerEmail }), null, {
        id: approvalId,
        tool: step.tool,
        args,
        expiresAt,
      });
    }
    const action = await loadAction(step);
    const filled = await resolveStepArgs(
      { tool: step.tool, goal: step.goal, args: {}, refresh: [], action, request, prior: prior.join("\n") },
      input,
      deps,
      state,
      emit
    );
    const requiredMissing = (action.required ?? []).filter((key) => !hasArg(filled?.args[key]));
    if (!filled || filled.ask.length || requiredMissing.length) {
      if (input.trigger === "schedule") {
        return finish("FAILED", `${NEEDS_ATTENTION} I couldn't fill in ${(filled?.ask.length ? filled.ask : requiredMissing).join(", ") || step.tool} for ${step.tool}.`, null, null);
      }
      return askFor(filled?.ask.length ? filled.ask : requiredMissing.length ? requiredMissing : [step.tool]);
    }
    const gate = gateDecision(step.tool);
    const key = idempotencyKey([input.userId, input.conversationId, step.tool, filled.args]);
    if (gate.decision === "hold" && !input.preapprovedExternal) {
      const approvalId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + BUDGETS.approvalTtlMs).toISOString();
      const digest = actionDigest(step.tool, filled.args);
      await deps.store.createApproval({
        id: approvalId,
        userId: input.userId,
        taskId: input.taskId,
        tool: step.tool,
        args: filled.args,
        digest,
        expiresAt,
        idempotencyKey: key,
      });
      await deps.store.audit(input.userId, "approval_requested", step.tool, digest);
      state.trace.push({ tool: step.tool, args: filled.args, effect: gate.effect, ok: false, queued: true });
      emit({ type: "approval", approval: { id: approvalId, tool: step.tool, args: filled.args, expiresAt } });
      return finish("WAITING_APPROVAL", describeApproval(step.tool, filled.args, { text: step.goal, ownerEmail: input.ownerEmail }), null, {
        id: approvalId,
        tool: step.tool,
        args: filled.args,
        expiresAt,
      });
    }
    if (gate.decision === "deny") {
      return finish("FAILED", `${NEEDS_ATTENTION} ${step.tool} isn't allowed, so I stopped before calling it.`, null, null);
    }
    emit({ type: "think", stage: "tool", text: `Using ${step.app} to ${step.goal.charAt(0).toLowerCase()}${step.goal.slice(1)}.` });
    const result = await deps.hub.call(input.userId, step.tool, { ...filled.args, idempotencyKey: key }, new Set([step.tool]));
    state.trace.push({ tool: step.tool, args: filled.args, effect: gate.effect, ok: result.ok, ...(result.ok ? {} : { error: result.error?.message }) });
    if (!result.ok) {
      return finish("FAILED", `${NEEDS_ATTENTION} ${step.tool} failed${result.error?.message ? `: ${result.error.message}` : "."}`, null, null);
    }
    prior.push(`${step.tool} result: ${clampText(JSON.stringify(result), 800).text}`);
    lines.push(`${step.app} is ready for "${step.goal}".`);
  }
  const reply = [links.length ? `Connect these apps, then say "Looks good, go" again:\n${links.join("\n")}` : "", lines.join("\n")].filter(Boolean).join("\n\n");
  return finish("MODEL_ANSWER", reply || "I couldn't run that plan.", null, null);
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
    const stepResult = await runStep(resumeFrom.checkpoint.plan, index, input, deps, budgets, state, [], history, emit, deps.now().getTime() + budgets.deadlineMs);
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
  emit: (event: RunEvent) => void,
  deadlineAt = Number.POSITIVE_INFINITY
): Promise<StepStop | null> {
  const step = plan.steps[index];
  if (state.toolCalls >= budgets.maxSteps) {
    return { stopReason: "STEP_BUDGET", reply: "I stopped because this task hit its step budget.", checkpoint: snapshot(plan, index, state), approval: null };
  }
  const fromHub = await deps.hub.list(input.userId, `${step.goal} ${step.toolQuery}`);
  const listed =
    step.tool && !fromHub.some((tool) => tool.name === step.tool)
      ? [
          {
            name: step.tool,
            description: step.goal,
            inputSchema: {},
            effect: classifyEffect(step.tool),
            provider: step.tool.startsWith("builtin.") ? ("builtin" as const) : ("composio" as const),
          },
          ...fromHub,
        ]
      : fromHub;
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
  const known = [...(input.catalogActions ?? []), ...(input.planning?.candidates ?? [])];
  const picked = step.tool ? known.filter((action) => action.slug === step.tool) : [];
  const missing = unconnectedHitLabels(picked, input.connections);
  const actionQuery = missing.length ? `${step.goal} ${step.toolQuery}` : `${step.goal} ${step.toolQuery} ${input.text}`;
  const selected = ensureSearchTools(
    listed,
    withConnectTool(ensureActionTools(actionQuery, listed, selectTools(actionQuery, listed)), listed, missing.length > 0),
    `${input.text} ${step.goal}`,
    appNames(input)
  );
  const allowed = allowlist(selected);
  const toolLines = selected.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n") || "(no tools matched this step)";
  for (let inner = 0; inner < budgets.innerLoops; inner++) {
    if (deps.now().getTime() > deadlineAt) {
      return { stopReason: "MODEL_ANSWER", reply: "I stopped so this answer could reach you. Ask me to continue the rest.", checkpoint: snapshot(plan, index, state), approval: null };
    }
    if (state.inputTokens + state.outputTokens >= budgets.maxTokens) {
      return { stopReason: "TOKEN_BUDGET", reply: "I stopped because this task hit its token budget.", checkpoint: snapshot(plan, index, state), approval: null };
    }
    const response = await complete(
      deps,
      state,
      input,
      "act",
      `${POLICY_SYSTEM}\n${ownerBrief(input)}\n${ACT_INSTRUCTION}\nStep goal: ${step.goal}\n${step.tool ? `Call ${step.tool} for this step. Do not search the web and do not call builtin.apps.connect instead.\n` : ""}Tools:\n${toolLines}`,
      pack(history, facts, input, budgets, state.observations),
      emit
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
      if (claimsNoTools(parsed.act.reply) && state.repairs < 2) {
        state.repairs += 1;
        state.observations.push("You have not searched yet. Call builtin.web.search. For a daily job call builtin.routines.create. Do not mention Zapier, Make, or Apps Script. Do not tell the user a tool id.");
        continue;
      }
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
      const priorSearches = state.trace.filter((entry) => isWebSearchTool(entry.tool)).length;
      if (isWebSearchTool(call.tool) && priorSearches >= 2) {
        return {
          stopReason: "MODEL_ANSWER",
          reply: "I already searched the web twice, so I'm stopping instead of repeating it. Ask for a specific fact if you still need one.",
          checkpoint: snapshot(plan, index, state),
          approval: null,
        };
      }
      if (isWebSearchTool(call.tool) && (Boolean(step.tool && !isWebSearchTool(step.tool)) || mentionsAppData(`${input.text} ${step.goal}`, appNames(input)))) {
        return {
          stopReason: "MODEL_ANSWER",
          reply: "That's stored in your apps, so I won't search the web for it. Connect the app and I'll read it there.",
          checkpoint: snapshot(plan, index, state),
          approval: null,
        };
      }
      if (!allowed.has(call.tool) || !spec) {
        state.trace.push({ tool: call.tool, args: call.args, effect: gate.effect, ok: false, denied: true, error: "NOT_ALLOWLISTED" });
        await deps.store.audit(input.userId, "tool_denied", call.tool, "not allowlisted");
        emit({ type: "think", stage: "tool", text: `I can't use ${approvalTitle(call.tool)} for this, so I stopped.` });
        return {
          stopReason: "MODEL_ANSWER",
          reply: `I stopped because ${approvalTitle(call.tool)} isn't available for this step. I won't search the web instead.`,
          checkpoint: snapshot(plan, index, state),
          approval: null,
        };
      }
      if (gate.decision === "deny") {
        state.trace.push({ tool: call.tool, args: call.args, effect: gate.effect, ok: false, denied: true, error: "DENIED" });
        await deps.store.audit(input.userId, "tool_denied", call.tool, "unknown effect");
        emit({ type: "think", stage: "tool", text: `I stopped. ${approvalTitle(call.tool)} isn't allowed.` });
        return {
          stopReason: "MODEL_ANSWER",
          reply: `I stopped because ${approvalTitle(call.tool)} isn't allowed. I won't look it up on the web instead.`,
          checkpoint: snapshot(plan, index, state),
          approval: null,
        };
      }
      const key = idempotencyKey([input.userId, input.conversationId, step.id, call.tool, call.args]);
      if (gate.decision === "hold" && !input.preapprovedExternal) {
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
        emit({ type: "think", stage: "approval", text: `This needs your approval before ${approvalTitle(call.tool).toLowerCase()} can run.` });
        emit({ type: "approval", approval: { id: approvalId, tool: call.tool, args: call.args, expiresAt } });
        const checkpoint = snapshot(plan, index + 1, state);
        checkpoint.held = { approvalId, stepIndex: index, tool: call.tool, args: call.args, idempotencyKey: key };
        return {
          stopReason: "WAITING_APPROVAL",
          reply: describeApproval(call.tool, call.args, { text: input.text, ownerEmail: input.ownerEmail }),
          checkpoint,
          approval: { id: approvalId, tool: call.tool, args: call.args, expiresAt },
        };
      }
      if (!isWebSearchTool(call.tool)) emit({ type: "think", stage: "tool", text: `Working on ${approvalTitle(call.tool)}.` });
      const cached = await deps.store.getEffect(input.userId, key);
      let result = cached ?? (await deps.hub.call(input.userId, call.tool, { ...call.args, idempotencyKey: key }, allowed));
      if (!cached && result.error?.code === "NOT_CONNECTED" && deps.connectApp) {
        const toolkit = toolkitSlugFromTool(call.tool);
        if (toolkit) {
          try {
            const link = await deps.connectApp(input.userId, toolkit);
            if ("url" in link) {
              emit({ type: "think", stage: "tool", text: `${link.app} is not connected, so I stopped.` });
              return {
                stopReason: "MODEL_ANSWER",
                reply: `Connect ${link.app} before I can do that: ${link.url}`,
                checkpoint: snapshot(plan, index, state),
                approval: null,
              };
            }
          } catch {
            // Keep the original not-connected error.
          }
        }
      }
      if (!cached && result.error?.code === "NOT_CONNECTED") {
        emit({ type: "think", stage: "tool", text: "That app is not connected, so I stopped." });
        return {
          stopReason: "MODEL_ANSWER",
          reply: "That app is not connected, so I stopped. I won't search the web for your account data.",
          checkpoint: snapshot(plan, index, state),
          approval: null,
        };
      }
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
      state.observations.push(wrapUntrusted(call.tool, clampText(JSON.stringify(result), 1200).text));
      if (isWebSearchTool(call.tool)) {
        const query = String(call.args.query ?? "that").slice(0, 80);
        const found = countSearchHits(result.data);
        emit({ type: "think", stage: "tool", text: `Searched the web for ${query}, found ${found} results.` });
      } else {
        emit({ type: "think", stage: "tool", text: result.ok ? `Finished ${approvalTitle(call.tool)}.` : `Could not complete ${approvalTitle(call.tool)}.` });
      }
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

async function recoverFromPlanFailure(
  deps: Deps,
  state: LoopState,
  input: TurnInput,
  history: ChatMessage[],
  facts: string[],
  emit: (event: RunEvent) => void
): Promise<string> {
  const response = await complete(
    deps,
    state,
    input,
    "act",
    `${POLICY_SYSTEM}\n${ownerBrief(input)}\nThe plan JSON could not be used. Reply helpfully in JSON: {"done":true,"reply":"...","calls":[]}. Answer the person, ask one clarifying question if needed, and do not say you failed to make a plan. If they described an agent, include a /create?idea= link. If they need an app that is not connected, say which app.`,
    pack(history, facts, input, { ...BUDGETS, ...deps.budgets }),
    emit
  );
  if (response) {
    const act = parseAct(response.text);
    const reply = (act.ok ? act.act.reply : response.text).trim();
    if (reply && !/usable plan/i.test(reply)) return reply;
  }
  return helpfulFallback(input.text);
}

function activeToolkits(input: TurnInput): string[] {
  return input.connections.filter((connection) => connection.status === "active").map((connection) => connection.toolkit);
}

function knownActions(input: TurnInput): CatalogAction[] {
  return [...(input.catalogActions ?? []), ...(input.planning?.candidates ?? [])];
}

function ownerBrief(input: TurnInput): string {
  const connected = activeToolkits(input);
  const missing = unconnectedHitLabels(knownActions(input), input.connections);
  const lines: string[] = [];
  if (input.ownerEmail) {
    lines.push(`The owner's email address is ${input.ownerEmail}. When they say me or my address, that is the recipient. Do not ask for it.`);
  }
  if (connected.length) lines.push(`Connected apps whose actions you can call: ${connected.join(", ")}.`);
  if (missing.length) {
    lines.push(`Not connected yet: ${missing.join(", ")}. Call builtin.apps.connect with {"app":"<name>"} and put the returned URL in the reply. Do not refuse.`);
  }
  return lines.join("\n");
}

async function attachConnectOffers(reply: string, input: TurnInput, deps: Deps): Promise<string> {
  const missing = unconnectedHitLabels(knownActions(input), input.connections);
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
      observations: observations.map((line) => clampText(line, 1500).text),
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
  messages: ChatMessage[],
  emit?: (event: RunEvent) => void
) {
  try {
    const response = await deps.model.complete({
      role,
      system,
      messages,
      onThinking:
        emit && role === "plan"
          ? (text) => {
              const clean = redactSecrets(text).replace(/\b[A-Z][A-Z0-9_]{8,}\b/g, "").replace(/\s+/g, " ").trim().slice(0, 240);
              if (clean) emit({ type: "think", stage: "reasoning", text: clean });
            }
          : undefined,
    });
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
