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
import { ambiguousToolkitGroups, describeHits, displayName, isWebSearchTool, parseCatalogDecision, proposalFromSteps, textNamesToolkit, toolkitLabels, toolkitOf, type CatalogAction, type PlanningState } from "./planning";
import { claimsNoTools, createAgentHref, ensureActionTools, helpfulFallback, looksLikeAgentBrief, nudgePlan, unconnectedApps, withConnectTool } from "./apps";
import { workflowOffer, type WorkflowOffer } from "./workflow";
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
  catalog?: string[];
  ownerEmail?: string;
  /** Set only by the scheduler after the owner approved the routine. */
  preapprovedExternal?: boolean;
  pendingPlan?: Proposal | null;
  planning?: PlanningState | null;
  catalogActions?: CatalogAction[];
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
      workflow: workflowOffer({
        request: planningState?.brief || input.text,
        trace: state.trace,
        proposal,
      }),
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

  stage("context", "Reading recent chat, saved notes, and past tasks.");
  const factHits = retrieve(input.text, input.facts, { userId: input.userId, limit: 5 });
  const chunkHits = retrieve(input.text, input.chunks, { userId: input.userId, limit: 4 });
  const history = [...input.history, { role: "user" as const, content: input.text }];
  const memoryNotes = [...factHits.map((fact) => fact.text), ...chunkHits.slice(0, 3).map((chunk) => chunk.text.slice(0, 500))];
  if (input.planning?.status === "ready" && input.planning.proposal?.mapped && isPlanApproval(input.text)) {
    stage("planner", "You approved the plan. I'll run the mapped actions, not a web search.");
    return runMappedPlan(input.planning.proposal, input, deps, state, emit, finish);
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
    if (decision.kind === "direct") return { done: false, plan: decision.plan };
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
      if (asked.has(decision.question.prompt)) {
        notes += "\nYou already asked that question. Ask something else or propose a plan.";
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
      const catalogSteps = mapped.filter((step) => !step.tool.startsWith("builtin."));
      if (!catalogSteps.length && mapped.every((step) => step.tool === "builtin.apps.connect")) {
        notes += "\nDo not propose connecting as the plan. Propose the catalog actions. Unconnected ones already get a Connect button.";
        continue;
      }
      if (mapped.some((step) => step.tool === "builtin.routines.create") && !asksForRecurrence(brief)) {
        notes += "\nThe user did not ask for a repeated schedule. Do not use builtin.routines.create. Propose the catalog actions for this request.";
        continue;
      }
      let next = proposalFromSteps(decision.understanding || brief, mapped);
      if (mapped.every((step) => step.tool === "builtin.routines.create") && asksForRecurrence(brief)) {
        return { done: true, result: await runMappedPlan(next, input, deps, state, emit, finish) };
      }
      if (catalogSteps.length && catalogSteps.every((step) => step.connected) && catalogSteps.every((step) => gateDecision(step.tool).decision !== "hold")) {
        return {
          done: false,
          plan: {
            intent: "act",
            success: decision.understanding || brief,
            steps: catalogSteps.map((step, index) => ({ id: `s${index + 1}`, goal: step.goal, toolQuery: step.tool, tool: step.tool })),
          },
        };
      }
      next = await attachStepLinks(next, input, deps);
      const planning = snapshot({ answers: input.planning?.answers ?? {}, status: "ready", question: null, proposal: next });
      setPlanning(planning);
      setProposal(next);
      emit({ type: "plan", proposal: next });
      return { done: true, result: await finish("MODEL_ANSWER", decision.understanding || "Here is a plan from the catalog.", null, null) };
    }
    notes += "\nThat was not usable JSON. Return one JSON object: action search, ask, propose, or a direct plan.";
  }
  return askOrProposeFromHits();

  function askOrProposeFromHits() {
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
  finish: (stop: StopReason, reply: string, checkpoint: Checkpoint | null, approval: RunResult["approval"]) => Promise<RunResult>
): Promise<RunResult> {
  const lines: string[] = [];
  const links: string[] = [];
  for (const step of proposal.mapped ?? []) {
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
    const gate = gateDecision(step.tool);
    if (gate.decision === "hold") {
      emit({ type: "think", stage: "approval", text: `${step.app} needs your approval before it runs.` });
      const approvalId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + BUDGETS.approvalTtlMs).toISOString();
      await deps.store.createApproval({
        id: approvalId,
        userId: input.userId,
        taskId: input.taskId,
        tool: step.tool,
        args: { prompt: proposal.understanding },
        digest: actionDigest(step.tool, { prompt: proposal.understanding }),
        expiresAt,
        idempotencyKey: idempotencyKey([input.userId, step.tool, proposal.understanding]),
      });
      emit({ type: "approval", approval: { id: approvalId, tool: step.tool, args: { prompt: proposal.understanding }, expiresAt } });
      return finish("WAITING_APPROVAL", describeApproval(step.tool, { cadence: "daily", prompt: step.goal || proposal.understanding, name: step.app }, { text: step.goal || proposal.understanding, ownerEmail: input.ownerEmail }), null, {
        id: approvalId,
        tool: step.tool,
        args: { prompt: proposal.understanding },
        expiresAt,
      });
    }
    emit({ type: "think", stage: "tool", text: `Using ${step.app} to ${step.goal.charAt(0).toLowerCase()}${step.goal.slice(1)}.` });
    const result = await deps.hub.call(input.userId, step.tool, { prompt: proposal.understanding }, new Set([step.tool]));
    state.trace.push({ tool: step.tool, args: { prompt: proposal.understanding }, effect: gate.effect, ok: result.ok, ...(result.ok ? {} : { error: result.error?.message }) });
    lines.push(result.ok ? `${step.app} is ready for "${step.goal}".` : `${step.app} could not do "${step.goal}".`);
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
  const missing = unconnectedApps(input.text, input.catalog ?? [], activeToolkits(input));
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

function ownerBrief(input: TurnInput): string {
  const connected = activeToolkits(input);
  const missing = unconnectedApps(input.text, input.catalog ?? [], connected);
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
