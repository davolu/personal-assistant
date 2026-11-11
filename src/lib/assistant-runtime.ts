import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaAssistantStore } from "@/lib/assistant-db";
import { createComposioProvider } from "@/lib/composio-provider";
import { createBuiltinProvider } from "@/assistant/builtin";
import { WEB_SEARCH_TOOL } from "@/assistant/composio-tools";
import { startConnectLink } from "@/lib/connect-link";
import { SUPPORTED_TOOLKITS } from "@/lib/toolkits";
import { ToolHub } from "@/assistant/hub";
import { httpMcpTransport, mcpCallTool, mcpListTools } from "@/assistant/mcp";
import { selectTools } from "@/assistant/registry";
import { createModelClient } from "@/assistant/model-client";
import { runTurn, type RunResult } from "@/assistant/orchestrator";
import type { Checkpoint, RunEvent, ToolProvider } from "@/assistant/types";
import { dueRoutines, nextRunAt } from "@/assistant/scheduler";
import { allowRate, allowSpend } from "@/assistant/cost";
import type { Proposal } from "@/assistant/types";
import { looksLikeAgentBrief, createAgentHref } from "@/assistant/apps";
import type { CatalogAction, PlanningState } from "@/assistant/planning";
import { eventPrompt } from "@/assistant/webhook";
import { settle, type Job } from "@/assistant/queue";
import { embedText } from "@/assistant/model-client";
import { chunkText } from "@/assistant/memory";

function mcpProviders(): ToolProvider[] {
  if (!process.env.MCP_SERVERS) return [];
  let servers: { name?: string; url?: string; token?: string }[] = [];
  try {
    const parsed = JSON.parse(process.env.MCP_SERVERS) as unknown;
    if (Array.isArray(parsed)) servers = parsed as typeof servers;
  } catch {
    return [];
  }
  return servers.flatMap((server) => {
    if (!server.name || !server.url) return [];
    const name = server.name;
    const transport = httpMcpTransport(server.url, server.token ? { authorization: `Bearer ${server.token}` } : {});
    const provider: ToolProvider = {
      id: "mcp",
      handles: (tool) => tool.startsWith(`mcp.${name}.`),
      async list(_userId, query) {
        const tools = await mcpListTools(name, transport, 8_000);
        return selectTools(query, tools, 8);
      },
      async call(_userId, tool, args) {
        return mcpCallTool(transport, tool.slice(`mcp.${name}.`.length), args, 15_000);
      },
    };
    return [provider];
  });
}

export function buildAssistant() {
  const store = createPrismaAssistantStore(prisma);
  const connectApp = (userId: string, app: string) => startConnectLink(userId, app);
  const routines = {
    async create(userId: string, input: { name: string; cadence: string; prompt: string; sendsApproved: boolean }) {
      const next = nextRunAt(input.cadence, new Date());
      return prisma.routine.create({
        data: {
          userId,
          name: input.name,
          cadence: input.cadence,
          prompt: input.prompt,
          sendsApproved: input.sendsApproved,
          nextRunAt: next,
        },
      });
    },
    async list(userId: string) {
      const rows = await prisma.routine.findMany({ where: { userId, enabled: true }, orderBy: { createdAt: "desc" }, take: 20 });
      return rows.map((row) => ({ id: row.id, name: row.name, cadence: row.cadence, prompt: row.prompt, enabled: row.enabled }));
    },
    async delete(userId: string, id: string) {
      const result = await prisma.routine.deleteMany({ where: { id, userId } });
      return result.count === 1;
    },
  };
  const webSearch = process.env.COMPOSIO_API_KEY
    ? async (userId: string, query: string) => {
        const { Composio } = await import("@composio/core");
        const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
        const result = await client.tools.execute(WEB_SEARCH_TOOL, {
          userId,
          arguments: { query },
          dangerouslySkipVersionCheck: true,
        });
        if (result.successful === false || result.error) {
          throw new Error(String(result.error ?? "Web search failed").slice(0, 200));
        }
        return result.data ?? result;
      }
    : undefined;
  const providers: ToolProvider[] = [createBuiltinProvider(store, () => new Date(), { connectApp, routines, webSearch })];
  if (process.env.COMPOSIO_API_KEY) providers.push(createComposioProvider());
  providers.push(...mcpProviders());
  return { store, hub: new ToolHub(providers), model: createModelClient(), now: () => new Date(), connectApp };
}

async function quota(userId: string) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(Date.now() - 10 * 60 * 1000);
  const [spend, recentTurns] = await Promise.all([
    prisma.assistantTask.aggregate({ where: { userId, createdAt: { gte: day } }, _sum: { costUsd: true } }),
    prisma.assistantTask.count({ where: { userId, createdAt: { gte: windowStart } } }),
  ]);
  return {
    dailySpendUsd: spend._sum.costUsd ?? 0,
    dailyLimitUsd: Number(process.env.ASSISTANT_DAILY_BUDGET_USD || 2),
    recentTurns,
    recentLimit: 20,
  };
}

function readProposal(value: unknown): Proposal | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Proposal>;
  if (!record.understanding || !Array.isArray(record.questions) || !Array.isArray(record.steps)) return null;
  if (record.status === "approved") return null;
  return {
    understanding: String(record.understanding),
    questions: record.questions.map((item) => String(item)).slice(0, 3),
    steps: record.steps.map((item) => String(item)).slice(0, 6),
    status: "proposed",
  };
}

function taskStatus(result: RunResult): string {
  if (result.stopReason === "WAITING_APPROVAL") return "waiting";
  if (result.stopReason === "MODEL_ANSWER" || result.stopReason === "ABSTAIN" || result.stopReason === "REJECTED") return "success";
  return "error";
}

function asPlanning(value: unknown): PlanningState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<PlanningState>;
  if (typeof record.brief !== "string" || !record.answers || typeof record.status !== "string") return null;
  return record as PlanningState;
}

async function searchLiveCatalog(userId: string, queries: string[]): Promise<CatalogAction[]> {
  if (!process.env.COMPOSIO_API_KEY) return [];
  try {
    const { Composio } = await import("@composio/core");
    const { searchSessionCatalog } = await import("@/lib/composio-provider");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    return await Promise.race([
      searchSessionCatalog(composio, userId, queries),
      new Promise<CatalogAction[]>((_, reject) => setTimeout(() => reject(new Error("catalog timeout")), 20000)),
    ]);
  } catch {
    return [];
  }
}

export async function planningView(userId: string, conversationId: string) {
  const row = await prisma.planningSession.findUnique({ where: { conversationId } }).catch(() => null);
  const state = row && row.userId === userId ? asPlanning(row.state) : null;
  if (!state) return { question: null, proposal: null, builderHref: null };
  return {
    question: state.status === "asking" ? state.question ?? null : null,
    proposal: state.status === "ready" ? state.proposal ?? null : null,
    builderHref: looksLikeAgentBrief(state.brief) ? createAgentHref(state.brief) : null,
  };
}

/** Edge check. The orchestrator checks again. Returns a message when the turn must not start. */
export async function gateChat(userId: string): Promise<string | null> {
  try {
    const spend = await quota(userId);
    if (!allowRate(spend.recentTurns, spend.recentLimit)) return "Too many requests in a short window. Wait a minute and try again.";
    if (!allowSpend(spend.dailySpendUsd, spend.dailyLimitUsd)) return "Today's model budget is used up.";
    return null;
  } catch {
    return null;
  }
}

export async function performTurn(opts: {
  userId: string;
  conversationId: string;
  text: string;
  untrusted?: string;
  trigger: "chat" | "schedule" | "event";
  preapprovedExternal?: boolean;
  onEvent?: (event: RunEvent) => void;
}): Promise<RunResult> {
  const agentPrefix = opts.text.match(/^agent-id:\S+\n/);
  const text = agentPrefix ? opts.text.slice(agentPrefix[0].length) : opts.text;
  const assistant = buildAssistant();
  const spend = await quota(opts.userId);
  const prior = await prisma.message.findMany({
    where: { conversationId: opts.conversationId, userId: opts.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  prior.reverse();
  await prisma.message.create({
    data: { conversationId: opts.conversationId, userId: opts.userId, role: "user", content: text.slice(0, 8000) },
  });
  const conversation = await prisma.conversation.findFirst({ where: { id: opts.conversationId, userId: opts.userId } });
  if (conversation && conversation.title === "New chat") {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { title: text.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat" },
    });
  }
  const task = await prisma.assistantTask.create({
    data: { userId: opts.userId, conversationId: opts.conversationId, trigger: opts.trigger, status: "running" },
  });
  const previous = await prisma.assistantTask.findFirst({
    where: { userId: opts.userId, conversationId: opts.conversationId, id: { not: task.id } },
    orderBy: { createdAt: "desc" },
    select: { plan: true },
  });
  const pendingPlan = readProposal(previous?.plan);
  const [facts, episodes, chunks, connections, account, savedPlanning] = await Promise.all([
    assistant.store.listFacts(opts.userId),
    prisma.episode.findMany({ where: { userId: opts.userId }, orderBy: { createdAt: "desc" }, take: 5 }),
    assistant.store.listChunks(opts.userId),
    prisma.connection.findMany({ where: { userId: opts.userId }, select: { toolkit: true, status: true } }).then((rows) =>
      rows.map((row) => ({ ...row, scopes: "" }))
    ),
    prisma.user.findUnique({ where: { id: opts.userId }, select: { email: true } }),
    prisma.planningSession.findUnique({ where: { conversationId: opts.conversationId } }).catch(() => null),
  ]);
  const result = await runTurn(
    {
      userId: opts.userId,
      conversationId: opts.conversationId,
      taskId: task.id,
      text,
      untrustedContext: opts.untrusted,
      trigger: opts.trigger,
      history: prior.map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: message.content })),
      facts,
      episodes: episodes.map((episode) => ({ summary: episode.summary, lesson: episode.lesson })),
      chunks,
      connections,
      catalog: [...SUPPORTED_TOOLKITS],
      ownerEmail: account?.email || undefined,
      preapprovedExternal: opts.preapprovedExternal,
      pendingPlan,
      planning: savedPlanning && savedPlanning.userId === opts.userId ? asPlanning(savedPlanning.state) : null,
      quota: spend,
    },
    { ...assistant, onEvent: opts.onEvent, searchCatalog: (queries) => searchLiveCatalog(opts.userId, queries) }
  );
  await prisma.assistantTask.update({
    where: { id: task.id },
    data: {
      status: taskStatus(result),
      stopReason: result.stopReason,
      summary: result.reply.slice(0, 500),
      plan: result.proposal ? (JSON.parse(JSON.stringify(result.proposal)) as Prisma.InputJsonValue) : undefined,
      checkpoint: result.checkpoint ? (JSON.parse(JSON.stringify(result.checkpoint)) as Prisma.InputJsonValue) : undefined,
      trace: JSON.parse(JSON.stringify(result.trace)) as Prisma.InputJsonValue,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      finishedAt: result.stopReason === "WAITING_APPROVAL" ? null : new Date(),
    },
  });
  if (result.planning) {
    const state = JSON.parse(JSON.stringify(result.planning)) as Prisma.InputJsonValue;
    await prisma.planningSession.upsert({
      where: { conversationId: opts.conversationId },
      create: { userId: opts.userId, conversationId: opts.conversationId, state },
      update: { state },
    }).catch(() => undefined);
  }
  await prisma.message.create({
    data: { conversationId: opts.conversationId, userId: opts.userId, role: "assistant", content: result.reply },
  });
  await prisma.conversation.update({
    where: { id: opts.conversationId },
    data: { updatedAt: new Date() },
  });
  return result;
}

export async function resumeApproval(opts: {
  userId: string;
  approvalId: string;
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
}): Promise<RunResult | null> {
  const assistant = buildAssistant();
  const approval = await assistant.store.getApproval(opts.userId, opts.approvalId);
  if (!approval) return null;
  const task = await prisma.assistantTask.findFirst({ where: { id: approval.taskId, userId: opts.userId } });
  if (!task?.checkpoint || !task.conversationId) return null;
  const result = await runTurn(
    {
      userId: opts.userId,
      conversationId: task.conversationId,
      taskId: task.id,
      text: "Resolve the held action",
      trigger: "chat",
      history: [],
      facts: [],
      episodes: [],
      chunks: [],
      connections: [],
      quota: await quota(opts.userId),
      resume: {
        checkpoint: task.checkpoint as Checkpoint,
        approval,
        decision: opts.decision,
        editedArgs: opts.editedArgs,
      },
    },
    assistant
  );
  await prisma.assistantTask.update({
    where: { id: task.id },
    data: {
      status: taskStatus(result),
      stopReason: result.stopReason,
      summary: result.reply.slice(0, 500),
      checkpoint: result.checkpoint ? (JSON.parse(JSON.stringify(result.checkpoint)) as Prisma.InputJsonValue) : undefined,
      trace: JSON.parse(JSON.stringify(result.trace)) as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  await prisma.message.create({
    data: { conversationId: task.conversationId, userId: opts.userId, role: "assistant", content: result.reply },
  });
  return result;
}

export async function saveUpload(userId: string, filename: string, text: string) {
  const sourceId = filename.slice(0, 120) || "upload.txt";
  const parts = chunkText(text, 800).slice(0, 40);
  await prisma.docChunk.deleteMany({ where: { userId, sourceId } });
  for (const [ordinal, part] of parts.entries()) {
    const vector = await embedText(part);
    await prisma.docChunk.create({
      data: { userId, sourceId, ordinal, text: part, ...(vector ? { embedding: vector } : {}) },
    });
  }
  return { sourceId, chunks: parts.length };
}

export async function enqueueEventRoutines(userId: string, toolkit: string, payload: string, eventId: string) {
  const routines = await prisma.routine.findMany({ where: { userId, enabled: true, cadence: "event", toolkit } });
  for (const routine of routines) {
    try {
      await prisma.assistantJob.create({
        data: {
          userId,
          kind: "event",
          idempotencyKey: `${eventId}:${routine.id}`.slice(0, 180),
          payload: { prompt: routine.prompt, untrusted: payload.slice(0, 4000), toolkit, name: routine.name },
        },
      });
    } catch {
      // The same event and routine were already queued.
    }
  }
}

export async function runDueWork(now = new Date()) {
  const routines = await prisma.routine.findMany({ where: { enabled: true } });
  const due = dueRoutines(
    routines.map((routine) => ({ ...routine, nextRunAt: routine.nextRunAt?.toISOString() ?? null })),
    now
  );
  for (const routine of due) {
    const idempotencyKey = `${routine.id}:${routine.nextRunAt ?? "first"}`.slice(0, 180);
    try {
      await prisma.assistantJob.create({
        data: {
          userId: routine.userId,
          kind: "routine",
          idempotencyKey,
          payload: {
            prompt: routine.prompt,
            name: routines.find((item) => item.id === routine.id)?.name ?? "Routine",
            sendsApproved: routines.find((item) => item.id === routine.id)?.sendsApproved ?? false,
          },
        },
      });
    } catch {
      // already queued for this slot
    }
    const following = nextRunAt(routine.cadence, now);
    await prisma.routine.update({
      where: { id: routine.id },
      data: { lastRunAt: now, nextRunAt: following },
    });
  }

  const expired = await prisma.assistantApproval.findMany({
    where: { status: "pending", expiresAt: { lt: now } },
    take: 50,
  });
  for (const approval of expired) {
    await prisma.assistantApproval.updateMany({
      where: { id: approval.id, status: "pending" },
      data: { status: "expired", resolvedAt: now, result: "expired" },
    });
    await prisma.assistantTask.updateMany({
      where: { id: approval.taskId, status: "waiting" },
      data: { status: "error", stopReason: "WAITING_EXPIRED", finishedAt: now },
    });
    await prisma.auditEvent.create({
      data: { userId: approval.userId, action: "approval_expired", tool: approval.tool, detail: approval.id },
    });
  }

  const queued = await prisma.assistantJob.findMany({
    where: { status: "queued", runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: 5,
  });
  let ran = 0;
  for (const row of queued) {
    const claimed = await prisma.assistantJob.updateMany({
      where: { id: row.id, status: "queued" },
      data: { status: "running", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const payload = row.payload as { prompt?: string; untrusted?: string; toolkit?: string; name?: string; sendsApproved?: boolean };
    try {
      const conversation = await prisma.conversation.create({
        data: { userId: row.userId, title: (payload.name || "Background task").slice(0, 80) },
      });
      const text = payload.untrusted
        ? eventPrompt(payload.prompt || "Look at this event", payload.toolkit || "app", "")
        : payload.prompt || "";
      const result = await performTurn({
        userId: row.userId,
        conversationId: conversation.id,
        text,
        untrusted: payload.untrusted,
        trigger: row.kind === "event" ? "event" : "schedule",
        preapprovedExternal: row.kind === "routine" && payload.sendsApproved === true,
      });
      const agentId = String(payload.prompt ?? "").match(/^agent-id:(\S+)/)?.[1];
      if (agentId) {
        const agent = await prisma.customAgent.findFirst({ where: { id: agentId, userId: row.userId } });
        const procedure = agent?.procedure && typeof agent.procedure === "object" ? (agent.procedure as Record<string, unknown>) : null;
        if (agent && procedure) {
          await prisma.customAgent.update({
            where: { id: agent.id },
            data: { procedure: { ...procedure, lastStatus: result.stopReason, lastRunAt: now.toISOString() } },
          });
        }
      }
      const [next] = settle([toJob(row, "running")], row.id, { ok: true }, now);
      await prisma.assistantJob.update({ where: { id: row.id }, data: { status: next.status, lastError: "" } });
      ran += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "job failed";
      const transient = /timeout|429|503|unavailable/i.test(message);
      const [next] = settle([toJob(row, "running", row.attempts + 1)], row.id, { ok: false, transient, error: message.slice(0, 300) }, now);
      await prisma.assistantJob.update({
        where: { id: row.id },
        data: { status: next.status, lastError: next.lastError, runAt: new Date(next.runAt) },
      });
    }
  }
  return { routines: due.length, jobs: ran, expired: expired.length };
}

function toJob(row: { id: string; userId: string; kind: string; payload: unknown; attempts: number; maxAttempts: number; runAt: Date; idempotencyKey: string }, status: Job["status"], attempts = row.attempts): Job {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    payload: row.payload,
    status,
    attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
    lastError: "",
  };
}
