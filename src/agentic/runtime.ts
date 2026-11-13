import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { runResearch } from "@/assistant/subagent";
import { createModelClient } from "@/assistant/model-client";
import { ToolHub } from "@/assistant/hub";
import { WEB_SEARCH_TOOL } from "@/assistant/composio-tools";
import type { ToolProvider } from "@/assistant/types";
import { createAgentDriver } from "./agent-model";
import { agentModel, createComputerModel } from "./claude";
import { defaultModelId } from "./models";
import { runComputerLoop } from "./computer";
import { createDesktopManager, desktopIdleMs, e2bFactory, memoryDesktopStore, type DesktopStore } from "./desktop";
import { createJevCritic } from "./jev";
import { fallbackSummary, memoryMemoryStore, type MemoryStore } from "./memory";
import { readBudgets } from "./budgets";
import { compileAgenticGraph, threadConfig, type AgenticDeps, type ComputerRunner, type EffectLedger } from "./graph";
import type { RunMeter } from "./run-guard";
import type { ToolOutcome, ToolRuntime } from "./tools";
import { createTracer } from "./tracing";

type SessionLike = {
  executeMeta(slug: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: unknown }>;
  authorize?(toolkit: string): Promise<{ redirectUrl?: string | null }>;
};

const sessions = new Map<string, Promise<SessionLike>>();

async function composioSession(userId: string): Promise<SessionLike> {
  const cached = sessions.get(userId);
  if (cached) return cached;
  const pending = (async () => {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    return composio.create(userId, { manageConnections: { enable: true } }) as Promise<SessionLike>;
  })();
  sessions.set(userId, pending);
  return pending;
}

function textOf(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 8000);
  } catch {
    return String(value).slice(0, 8000);
  }
}

function findUrl(value: unknown, depth = 0): string | null {
  if (depth > 4 || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["redirect_url", "redirectUrl", "url", "auth_url", "connect_url"]) {
    if (typeof record[key] === "string" && record[key].startsWith("http")) return record[key];
  }
  for (const child of Object.values(record)) {
    const found = findUrl(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function createProductionTools(meter?: RunMeter): ToolRuntime {
  return {
    async searchTools(userId, args) {
      if (!process.env.COMPOSIO_API_KEY) return { content: "COMPOSIO_API_KEY is not set.", isError: true, effect: "read" };
      try {
        const session = await composioSession(userId);
        const queries = Array.isArray(args.queries) ? args.queries : [{ use_case: String(args.query ?? args.use_case ?? "") }];
        const result = await session.executeMeta("COMPOSIO_SEARCH_TOOLS", { queries });
        return { content: textOf(result.data ?? result), isError: false, effect: "read" };
      } catch (err) {
        return { content: err instanceof Error ? err.message : "Tool search failed", isError: true, effect: "read" };
      }
    },
    async connectApp(userId, args) {
      const toolkit = String(args.toolkit ?? args.app ?? "");
      if (!toolkit) return { content: "Name the app to connect.", isError: true };
      if (!process.env.COMPOSIO_API_KEY) return { content: "COMPOSIO_API_KEY is not set.", isError: true };
      try {
        const session = await composioSession(userId);
        const meta = await session.executeMeta("COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [toolkit] }).catch(() => null);
        let url = findUrl(meta?.data);
        if (!url && session.authorize) {
          const link = await session.authorize(toolkit).catch(() => null);
          url = link?.redirectUrl ?? null;
        }
        if (!url) return { content: `${toolkit} did not return a connect link. It may already be connected.`, isError: false };
        return { content: `Connect ${toolkit}: ${url}`, isError: false, connect: { app: toolkit, url } };
      } catch (err) {
        return { content: err instanceof Error ? err.message : "Could not start the connection.", isError: true };
      }
    },
    async executeTools(userId, args) {
      if (!process.env.COMPOSIO_API_KEY) return { content: "COMPOSIO_API_KEY is not set.", isError: true };
      try {
        const session = await composioSession(userId);
        const result = await session.executeMeta("COMPOSIO_MULTI_EXECUTE_TOOL", {
          tools: args.tools,
          thought: args.thought,
          sync_response_to_workbench: false,
        });
        const data = result.data as { error_count?: number; results?: unknown } | undefined;
        const failed = (data?.error_count ?? 0) > 0 || Boolean(result.error);
        return { content: textOf(result.data ?? result), isError: failed, effect: "read" };
      } catch (err) {
        return { content: err instanceof Error ? err.message : "Tool execution failed", isError: true };
      }
    },
    async webSearch(userId, query) {
      if (!process.env.COMPOSIO_API_KEY) return { content: "Web search is not configured.", isError: true, effect: "read" };
      try {
        const { Composio } = await import("@composio/core");
        const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
        const result = await client.tools.execute(WEB_SEARCH_TOOL, { userId, arguments: { query }, dangerouslySkipVersionCheck: true });
        if (result.successful === false || result.error) return { content: String(result.error ?? "Web search failed"), isError: true, effect: "read" };
        await meter?.chargeSearch();
        return { content: textOf(result.data ?? result), isError: false, effect: "read" };
      } catch (err) {
        return { content: err instanceof Error ? err.message : "Web search failed", isError: true, effect: "read" };
      }
    },
    async research(userId, goal) {
      try {
        const model = createModelClient();
        const web = this.webSearch.bind(this);
        const provider: ToolProvider = {
          id: "builtin",
          handles: (name) => name === "builtin.web.search",
          async list() {
            return [{ name: "builtin.web.search", description: "Search the public web", inputSchema: {}, effect: "read", provider: "builtin" }];
          },
          async call(callUser, name, args) {
            if (name !== "builtin.web.search") return { ok: false, error: { code: "NOT_ALLOWLISTED", message: name } };
            const outcome = await web(callUser, String(args.query ?? ""));
            return outcome.isError ? { ok: false, error: { code: "TOOL_FAILED", message: outcome.content } } : { ok: true, data: outcome.content };
          },
        };
        const cheap = {
          async complete(req: Parameters<typeof model.complete>[0]) {
            const response = await model.complete({ ...req, role: "summarize" });
            await meter?.chargeClient(response.model, response.inputTokens, response.outputTokens);
            return response;
          },
        };
        const found = await runResearch({
          userId,
          goal,
          model: cheap,
          hub: new ToolHub([provider]),
          tools: [{ name: "builtin.web.search", description: "Search the public web", inputSchema: {}, effect: "read", provider: "builtin" }],
          maxCalls: 4,
        });
        return { content: found.summary, isError: false, effect: "read" };
      } catch (err) {
        return { content: err instanceof Error ? err.message : "Research failed", isError: true, effect: "read" };
      }
    },
  };
}

const memoryLedgers = new Map<string, string>();

export function memoryLedger(): EffectLedger {
  return {
    async get(_userId, key) {
      return memoryLedgers.get(key) ?? null;
    },
    async put(_userId, key, result) {
      if (!memoryLedgers.has(key)) memoryLedgers.set(key, result);
    },
  };
}

let desktopStore: DesktopStore = memoryDesktopStore();

export function setDesktopStore(store: DesktopStore) {
  desktopStore = store;
}

export function createComputerRunner(meter?: RunMeter): ComputerRunner {
  const idleMs = desktopIdleMs();
  const manager = createDesktopManager({
    store: desktopStore,
    factory: e2bFactory(),
    now: () => Date.now(),
    idleMs,
  });
  return {
    async run(input) {
      if (!process.env.E2B_API_KEY) return { status: "error", message: "E2B_API_KEY is not set." };
      const denied = await meter?.allowDesktop();
      if (denied) return { status: "error", message: denied };
      const started = Date.now();
      const existing = await desktopStore.get(input.userId);
      const waking = !existing || existing.pausedAt != null || Date.now() - existing.lastUsedAt >= idleMs;
      try {
        const desktop = await manager.open(input.userId);
        const model = createComputerModel();
        return await runComputerLoop({
          task: input.task,
          desktop,
          model,
          maxSteps: readBudgets().computerSteps,
          checkpoint: input.checkpoint,
          resume: input.resume
            ? { kind: input.resume.kind === "approval" ? "approval" : "ask", text: input.resume.text, decision: input.resume.decision }
            : undefined,
          onUsage: async (usage) => {
            if (!meter) return null;
            return meter.afterModel(agentModel(), usage);
          },
        });
      } catch (err) {
        return { status: "error", message: err instanceof Error ? err.message : "Desktop failed" };
      } finally {
        const active = Math.max(1, Math.ceil((Date.now() - started) / 1000));
        const idle = waking ? Math.ceil(idleMs / 1000) : 0;
        await meter?.chargeDesktop(active + idle).catch(() => undefined);
      }
    },
    async stream(userId: string) {
      return manager.stream(userId);
    },
  } as ComputerRunner & { stream(userId: string): Promise<{ sandboxId: string; streamUrl: string } | null> };
}

export function productionDeps(onEvent?: AgenticDeps["onEvent"], meter?: RunMeter): AgenticDeps {
  const tracer = createTracer();
  return {
    budgets: readBudgets(),
    claude: createAgentDriver(),
    critic: createJevCritic(),
    tools: createProductionTools(meter),
    memory: memoryMemoryStore(),
    computer: createComputerRunner(meter),
    guard: meter,
    ledger: memoryLedger(),
    schedules: {
      async save(input) {
        const { saveApprovedSchedule } = await import("./schedule-store");
        return saveApprovedSchedule(input);
      },
    },
    summarize: async (messages) => {
      try {
        const model = createModelClient();
        const response = await model.complete({
          role: "summarize",
          system: "Summarize this chat for the assistant's future context. Keep names, decisions, and unfinished tasks. Do not invent sends.",
          messages: [{ role: "user", content: fallbackSummary(messages) }],
        });
        await meter?.chargeClient(response.model, response.inputTokens, response.outputTokens);
        return response.text || fallbackSummary(messages);
      } catch {
        return fallbackSummary(messages);
      }
    },
    onEvent: (event) => {
      tracer.event(event.type, { summary: "summary" in event ? String(event.summary ?? "") : event.type });
      onEvent?.(event);
    },
    now: () => Date.now(),
  };
}

let checkpointerPromise: Promise<BaseCheckpointSaver> | null = null;
let durableMemory: Promise<MemoryStore> | null = null;
let durableLedger: Promise<EffectLedger> | null = null;
const processMemory = memoryMemoryStore();

export async function getAgenticGraph(onEvent?: AgenticDeps["onEvent"], meter?: RunMeter) {
  if (process.env.DATABASE_URL) {
    const postgres = await import("./postgres");
    setDesktopStore(postgres.createPostgresDesktopStore());
    durableMemory ??= Promise.resolve(postgres.createPostgresMemory());
    durableLedger ??= Promise.resolve(postgres.createPostgresLedger());
  }
  const checkpointer = await (checkpointerPromise ??= createCheckpointer());
  const deps = productionDeps(onEvent, meter);
  deps.memory = durableMemory ? await durableMemory : processMemory;
  if (durableLedger) deps.ledger = await durableLedger;
  return { graph: compileAgenticGraph(deps, checkpointer), checkpointer };
}

async function createCheckpointer(): Promise<BaseCheckpointSaver> {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) return new MemorySaver();
  const saver = PostgresSaver.fromConnString(url);
  await saver.setup();
  return saver;
}

export async function loadMemoryStore(): Promise<MemoryStore> {
  if (!process.env.DATABASE_URL) return memoryMemoryStore();
  const { createPostgresMemory } = await import("./postgres");
  return createPostgresMemory();
}

export { threadConfig };

export function missingModelMessage(): string | null {
  if (defaultModelId()) return null;
  return "Set a provider key such as ANTHROPIC_API_KEY to talk to the agent. The page is up, and no model is configured yet.";
}
