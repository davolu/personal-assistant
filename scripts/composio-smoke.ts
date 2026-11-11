/**
 * Live Composio check. Not part of npm test.
 * Run: npx tsx scripts/composio-smoke.ts
 * Reads COMPOSIO_API_KEY and optional ANTHROPIC_API_KEY from the environment.
 * Never prints those values. Exits 0 with SKIPPED when COMPOSIO_API_KEY is absent.
 *
 * Discovery goes through a Tool Router session's search (COMPOSIO_SEARCH_TOOLS).
 * Each turn must finish in under 45s with no web search.
 */
import { Composio } from "@composio/core";
import { createBuiltinProvider } from "../src/assistant/builtin";
import { MemoryStore } from "../src/assistant/memory-store";
import { ToolHub } from "../src/assistant/hub";
import { createModelClient } from "../src/assistant/model-client";
import { runTurn } from "../src/assistant/orchestrator";
import type { CatalogAction } from "../src/assistant/planning";
import { isWebSearchTool } from "../src/assistant/planning";
import { searchSessionCatalog } from "../src/lib/composio-provider";

const key = process.env.COMPOSIO_API_KEY;
if (!key) {
  console.log("SKIPPED: COMPOSIO_API_KEY is not set");
  process.exit(0);
}

const TURN_MS = 45_000;
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error("ASSERT", message);
}

function isGmailFetch(action: CatalogAction): boolean {
  return action.slug.startsWith("GMAIL_") && /FETCH|LIST/.test(action.slug) && /EMAIL|MESSAGE|THREAD/.test(action.slug) && !/LABEL|_BY_/.test(action.slug);
}

function isVideoGeneration(action: CatalogAction): boolean {
  const blob = `${action.slug} ${action.description ?? ""}`.toUpperCase();
  if (/MUSIC|THUMBNAIL|TRANSCRIPT/.test(blob)) return false;
  return /VIDEO/.test(blob) && /GENERAT|CREATE/.test(action.slug.toUpperCase());
}

async function search(composio: Composio, query: string): Promise<CatalogAction[]> {
  const started = Date.now();
  const actions = await searchSessionCatalog(composio, "smoke-dry-run", [query]);
  const elapsed = Date.now() - started;
  console.log("search", JSON.stringify({ query, ms: elapsed, tools: actions.slice(0, 8).map((action) => action.slug), toolkits: [...new Set(actions.map((action) => action.toolkit))].slice(0, 8) }));
  if (elapsed >= TURN_MS) fail(`${query} took ${elapsed}ms`);
  return actions;
}

async function main(): Promise<void> {
  const composio = new Composio({ apiKey: key });
  const notion = await search(composio, "summarise what I have done on canvas into my notion list");
  if (!notion.some((action) => action.slug.startsWith("NOTION_") || action.toolkit === "notion")) {
    fail(`canvas to notion did not pick a Notion action: ${notion.slice(0, 6).map((action) => action.slug).join(", ") || "none"}`);
  }

  const unread = await search(composio, "check my latest unread email");
  const gmail = unread.find((action) => action.slug.startsWith("GMAIL_") || action.toolkit === "gmail");
  console.log("unread_email", gmail?.slug ?? "none");
  if (!gmail || !isGmailFetch(gmail)) fail(`unread email picked ${gmail?.slug ?? "nothing"} instead of a Gmail fetch`);

  const bridge = await search(composio, "get the latest YouTube video and post it to a Telegram channel");
  if (!bridge.some((action) => action.toolkit === "telegram" || action.slug.startsWith("TELEGRAM_"))) {
    fail(`YouTube to Telegram did not include Telegram: ${[...new Set(bridge.map((action) => action.toolkit))].join(", ") || "none"}`);
  }

  const board = await search(composio, "put a Google Calendar event onto a Trello card");
  const kits = new Set(board.map((action) => action.toolkit ?? ""));
  console.log("calendar_trello", [...kits].join(", "));
  if (![...kits].some((toolkit) => toolkit.includes("calendar")) || !kits.has("trello")) {
    fail(`Calendar to Trello missed a toolkit: ${[...kits].join(", ") || "none"}`);
  }

  const video = await search(composio, "make a 5 minute animated video with characters");
  const videoPick = video.find(isVideoGeneration);
  console.log("video_plan", video[0]?.slug ?? "none", videoPick?.slug ?? "none");
  if (!videoPick) fail(`video plan is not a video-generation action: ${video.slice(0, 6).map((action) => action.slug).join(", ") || "none"}`);
  if (video[0] && /MUSIC|THUMBNAIL|TRANSCRIPT/.test(`${video[0].slug} ${video[0].description ?? ""}`.toUpperCase())) {
    fail(`video plan picked ${video[0].slug}`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    if (failures.length) {
      console.error(`FAILED ${failures.length}`);
      process.exit(1);
    }
    console.log("SKIPPED: agent turns, ANTHROPIC_API_KEY is not set");
    process.exit(0);
  }

  const prompts = [
    "Can you summarise all I've done on canvas to my notion list?",
    "check my latest unread email",
    "get the latest YouTube video and post it to a Telegram channel",
    "put today's Google Calendar event onto a Trello card",
    "Make me a 5 minute animated video with characters about my product",
  ];
  for (const text of prompts) {
    const started = Date.now();
    const trace: string[] = [];
    const result = await runTurn(
      {
        userId: "smoke-dry-run",
        conversationId: "smoke",
        taskId: "smoke",
        text,
        trigger: "chat",
        history: [],
        facts: [],
        episodes: [],
        chunks: [],
        connections: [],
        catalog: [],
        ownerEmail: "owner@example.com",
        quota: { dailySpendUsd: 0, dailyLimitUsd: 2, recentTurns: 0, recentLimit: 20 },
      },
      {
        model: createModelClient(),
        hub: new ToolHub([createBuiltinProvider(new MemoryStore(), () => new Date())], 1000),
        store: new MemoryStore(),
        now: () => new Date(),
        searchCatalog: (queries) => searchSessionCatalog(composio, "smoke-dry-run", queries),
        budgets: { deadlineMs: TURN_MS },
      }
    );
    const elapsed = Date.now() - started;
    const tools = [
      ...(result.proposal?.mapped?.map((step) => step.tool) ?? []),
      ...result.trace.map((entry) => entry.tool),
    ];
    trace.push(...result.trace.map((entry) => entry.tool));
    console.log("turn", JSON.stringify({ ms: elapsed, stop: result.stopReason, tools, reply: result.reply.slice(0, 180), question: result.question?.prompt ?? null }));
    if (elapsed >= TURN_MS) fail(`${text} took ${elapsed}ms`);
    if (trace.some((tool) => isWebSearchTool(tool)) || /web search/i.test(result.reply)) fail(`${text} used web search`);
    if (/couldn.?t match/i.test(result.reply) && tools.length === 0 && !result.question) fail(`${text} said it couldn't match`);
  }

  if (failures.length) {
    console.error(`FAILED ${failures.length}`);
    process.exit(1);
  }
  console.log("smoke passed");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "smoke failed";
  console.error(message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 400));
  process.exit(1);
});
