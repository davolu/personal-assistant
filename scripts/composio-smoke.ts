/**
 * Live Composio check. Not part of npm test.
 * Run: npx tsx scripts/composio-smoke.ts
 * Reads COMPOSIO_API_KEY and optional ANTHROPIC_API_KEY from the environment.
 * Never prints those values. Exits 0 with SKIPPED when COMPOSIO_API_KEY is absent.
 */
import { Composio } from "@composio/core";
import { createBuiltinProvider } from "../src/assistant/builtin";
import { loadCatalogTools } from "../src/assistant/composio-tools";
import { MemoryStore } from "../src/assistant/memory-store";
import { ToolHub } from "../src/assistant/hub";
import { createModelClient } from "../src/assistant/model-client";
import { runTurn } from "../src/assistant/orchestrator";
import { createComposioProvider, listComposioRaw } from "../src/lib/composio-provider";

const key = process.env.COMPOSIO_API_KEY;
if (!key) {
  console.log("SKIPPED: COMPOSIO_API_KEY is not set");
  process.exit(0);
}

async function main(): Promise<void> {
const composio = new Composio({ apiKey: key });
const source = {
  async listRaw(query: { toolkits?: string[]; tools?: string[]; search?: string }) {
    return listComposioRaw(composio.tools, query);
  },
};

function names(tools: { name: string }[]): string[] {
  return tools.slice(0, 8).map((tool) => tool.name);
}

const listed = (await composio.toolkits.get({})) as { items?: unknown[] };
const toolkitCount = Array.isArray(listed.items) ? listed.items.length : 0;
console.log("toolkits", toolkitCount);

for (const query of ["gmail send email", "web search", "zoho crm"]) {
  const tools = await loadCatalogTools(query, [], source);
  console.log("search", JSON.stringify({ query, tools: names(tools) }));
}

const web = await composio.tools.execute("COMPOSIO_SEARCH_WEB", {
  userId: "smoke-dry-run",
  arguments: { query: "latest nonprofit grants" },
  dangerouslySkipVersionCheck: true,
});
const webText = JSON.stringify(web.data ?? web.error ?? "").slice(0, 240);
console.log("web_search", JSON.stringify({ ok: web.successful !== false && !web.error, preview: webText }));

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("SKIPPED: agent turn, ANTHROPIC_API_KEY is not set");
  process.exit(0);
}

const chosen: string[] = [];
const routines: string[] = [];
const base = createComposioProvider({ slugsForUser: async () => [], source });
const provider = {
  id: "composio" as const,
  handles: (name: string) => base.handles?.(name) ?? false,
  list: (userId: string, query: string) => base.list(userId, query),
  async call(userId: string, name: string, args: Record<string, unknown>) {
    chosen.push(name);
    if (/SEND|DELETE|PAY|CHARGE/.test(name)) return { ok: true, data: { dry_run: true } };
    return base.call(userId, name, args);
  },
};
const store = new MemoryStore();
const now = () => new Date();
const hub = new ToolHub([
  createBuiltinProvider(store, now, {
    routines: {
      async create(_userId, input) {
        routines.push(`${input.cadence}: ${input.prompt}`);
        return { id: "dry", name: input.name, cadence: input.cadence, prompt: input.prompt, enabled: true };
      },
      async list() {
        return [];
      },
      async delete() {
        return false;
      },
    },
  }),
  provider,
]);

const result = await runTurn(
  {
    userId: "smoke-dry-run",
    conversationId: "smoke",
    taskId: "smoke",
    text: "Search for latest grants and send to my email once a day",
    trigger: "chat",
    history: [],
    facts: [],
    episodes: [],
    chunks: [],
    connections: [],
    catalog: ["Gmail", "Runway", "HeyGen", "Descript"],
    ownerEmail: "owner@example.com",
    quota: { dailySpendUsd: 0, dailyLimitUsd: 2, recentTurns: 0, recentLimit: 20 },
  },
  { model: createModelClient(), hub, store, now }
);

console.log(
  JSON.stringify({
    stopReason: result.stopReason,
    tools: [...new Set([...chosen, ...result.trace.map((entry) => entry.tool)])],
    routineWouldBeCreated: routines.length > 0 || result.approval?.tool === "builtin.routines.create",
    approval: result.approval?.tool ?? null,
    reply: result.reply.slice(0, 400),
  })
);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "smoke failed";
  console.error(message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 400));
  process.exit(1);
});
