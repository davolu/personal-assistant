/**
 * Live Composio check. Not part of npm test.
 * Run: npx tsx scripts/composio-smoke.ts
 * Reads COMPOSIO_API_KEY and optional ANTHROPIC_API_KEY from the environment.
 * Never prints those values. Exits 0 with SKIPPED when COMPOSIO_API_KEY is absent.
 */
import { Composio } from "@composio/core";
import { createBuiltinProvider } from "../src/assistant/builtin";
import { loadCatalogTools, WEB_SEARCH_TOOL } from "../src/assistant/composio-tools";
import { rankActions, toolkitOf } from "../src/assistant/planning";
import { MemoryStore } from "../src/assistant/memory-store";
import { ToolHub } from "../src/assistant/hub";
import { createModelClient } from "../src/assistant/model-client";
import { runTurn } from "../src/assistant/orchestrator";
import { createComposioProvider, listAllToolkitActions, listComposioRaw } from "../src/lib/composio-provider";

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

function fail(message: string): never {
  console.error("ASSERT", message);
  process.exit(1);
}

const page = await composio.getClient().toolkits.list({ limit: 1 });
let toolkitCount = typeof page.total_items === "number" ? page.total_items : 0;
if (toolkitCount <= 0) {
  const listed = await composio.toolkits.get({ limit: 1000 });
  toolkitCount = Array.isArray(listed) ? listed.length : 0;
}
console.log("toolkits", toolkitCount);
if (!(toolkitCount > 0)) fail(`toolkits > 0, got ${toolkitCount}`);

const searches = new Map<string, { name: string }[]>();
for (const query of ["gmail send email", "web search", "zoho crm"]) {
  const tools = await loadCatalogTools(query, [], source);
  searches.set(query, tools);
  console.log("search", JSON.stringify({ query, tools: names(tools) }));
}
const gmail = searches.get("gmail send email") ?? [];
const gmailNames = gmail.map((tool) => tool.name);
if (!gmailNames[0]?.startsWith("GMAIL_")) fail(`gmail top hit is ${gmailNames[0] ?? "empty"}`);
if (!gmailNames.slice(0, 5).includes("GMAIL_SEND_EMAIL")) fail(`GMAIL_SEND_EMAIL not in top 5: ${gmailNames.slice(0, 5).join(", ")}`);
if (!gmailNames.slice(0, 5).includes("GMAIL_CREATE_EMAIL_DRAFT")) fail(`GMAIL_CREATE_EMAIL_DRAFT not in top 5: ${gmailNames.slice(0, 5).join(", ")}`);
const zoho = searches.get("zoho crm") ?? [];
if (!zoho[0]?.name.startsWith("ZOHO_")) fail(`zoho top hit is ${zoho[0]?.name ?? "empty"}`);
if (gmail.some((tool) => tool.name.startsWith("COMPOSIO_SEARCH")) || zoho.some((tool) => tool.name.startsWith("COMPOSIO_SEARCH"))) {
  fail("web search tools were mixed into app search hits");
}

const web = await composio.tools.execute("COMPOSIO_SEARCH_WEB", {
  userId: "smoke-dry-run",
  arguments: { query: "latest nonprofit grants" },
  dangerouslySkipVersionCheck: true,
});
const webText = JSON.stringify(web.data ?? web.error ?? "").slice(0, 240);
console.log("web_search", JSON.stringify({ ok: web.successful !== false && !web.error, preview: webText }));

const videoPage = (await composio.getClient().toolkits.list({ search: "video", limit: 4 } as { search: string; limit: number })) as
  | { slug?: string }[]
  | { items?: { slug?: string }[] };
const videoToolkits = (Array.isArray(videoPage) ? videoPage : videoPage.items ?? []).map((item) => item.slug).filter((slug): slug is string => Boolean(slug));
const ranked: string[] = [];
for (const slug of videoToolkits) {
  const actions = await listAllToolkitActions(composio, slug).catch(() => []);
  const best = rankActions(actions.map((action) => ({ ...action, toolkit: toolkitOf(action.slug) })), slug, "generate a video from a script");
  if (!best) continue;
  const generateExists = actions.some((action) => /GENERATE|CREATE|CONVERT/.test(action.slug) && !/RETRIEVE|STATUS|DELETE/.test(action.slug));
  if (generateExists && /RETRIEVE|STATUS|DELETE/.test(best.slug)) fail(`${slug} ranked ${best.slug} ahead of a generate action`);
  ranked.push(best.slug);
}
console.log("video_rank", ranked.join(", ") || "none");

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
    webSearch: async (userId, query) => {
      const result = await composio.tools.execute(WEB_SEARCH_TOOL, {
        userId,
        arguments: { query },
        dangerouslySkipVersionCheck: true,
      });
      return result.data ?? result.error ?? { ok: false };
    },
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

const summary = {
  stopReason: result.stopReason,
  tools: [...new Set([...chosen, ...result.trace.map((entry) => entry.tool)])],
  routineWouldBeCreated: routines.length > 0 || result.approval?.tool === "builtin.routines.create",
  approval: result.approval?.tool ?? null,
  reply: result.reply.slice(0, 400),
};
console.log(JSON.stringify(summary));
if (summary.approval === "builtin.routines.create") {
  if (/builtin\.|COMPOSIO_|GMAIL_/.test(summary.reply)) fail(`approval reply contains a tool id: ${summary.reply}`);
  if (!/Approve to set up this daily routine/.test(summary.reply)) fail(`approval reply is not human: ${summary.reply}`);
  if (!summary.reply.includes("owner@example.com")) fail(`approval reply missing the owner email: ${summary.reply}`);
}
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "smoke failed";
  console.error(message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 400));
  process.exit(1);
});
