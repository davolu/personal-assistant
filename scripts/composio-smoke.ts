/**
 * Live Composio check. Not part of npm test.
 * Run: npx tsx scripts/composio-smoke.ts
 * Reads COMPOSIO_API_KEY and optional ANTHROPIC_API_KEY from the environment.
 * Never prints those values. Exits 0 with SKIPPED when a key is absent.
 *
 * Drives the chat planner. Discovery is session.search, one query per sub-task.
 * Each turn must finish in under 45s with no web search.
 */
import { Composio } from "@composio/core";
import { createBuiltinProvider } from "../src/assistant/builtin";
import { MemoryStore } from "../src/assistant/memory-store";
import { ToolHub } from "../src/assistant/hub";
import { createModelClient } from "../src/assistant/model-client";
import { runTurn, type RunResult } from "../src/assistant/orchestrator";
import { isWebSearchTool, type PlanningState } from "../src/assistant/planning";
import { replayPrompt, savedStepsLine, workflowOffer, type WorkflowOffer } from "../src/assistant/workflow";
import { createComposioProvider, listActiveConnections, searchSessionCatalog, searchToolkitsByName } from "../src/lib/composio-provider";
import type { ChatMessage } from "../src/assistant/types";

const key = process.env.COMPOSIO_API_KEY;
if (!key) {
  console.log("SKIPPED: COMPOSIO_API_KEY is not set");
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.log("SKIPPED: ANTHROPIC_API_KEY is not set");
  process.exit(0);
}

const TURN_MS = 45_000;
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error("ASSERT", message);
}

type Step = { tool: string; toolkit: string; app: string; connectUrl?: string };

function planSteps(result: RunResult): Step[] {
  return (result.proposal?.mapped ?? []).map((step) => ({
    tool: step.tool,
    toolkit: step.toolkit,
    app: step.app,
    connectUrl: step.connectUrl,
  }));
}

/** Composio's toolkit slug or the name session.toolkits returned. A *_mcp slug counts only when that name matches. */
function isToolkit(step: Step, slug: string, name: string): boolean {
  const toolkit = step.toolkit.toLowerCase();
  const label = step.app.toLowerCase();
  if (toolkit === slug || label === name) return true;
  return toolkit === `${slug}_mcp` && label === name;
}

function isVideoGeneration(slug: string): boolean {
  const upper = slug.toUpperCase();
  if (/IMAGE|MUSIC|THUMBNAIL|TRANSCRIPT/.test(upper)) return false;
  return /VIDEO/.test(upper) && /GENERAT|CREATE/.test(upper);
}

async function actingUser(composio: Composio): Promise<{ userId: string; slugs: string[] }> {
  const items = await listActiveConnections(composio);
  const gmail = items.find((item) => item.toolkit?.slug === "gmail" && item.user_id);
  const userId = gmail?.user_id ?? items.find((item) => item.user_id)?.user_id ?? "smoke-dry-run";
  const slugs = [...new Set(items.filter((item) => item.user_id === userId).map((item) => item.toolkit?.slug ?? "").filter(Boolean))];
  console.log("acting_user", JSON.stringify({ gmail: Boolean(gmail), toolkits: slugs, pages: items.length }));
  return { userId, slugs };
}

async function chat(composio: Composio, userId: string, slugs: string[], prompt: string, prefer: string[], freeText: string, stopOnQuestion = false, seenQuestions?: string[]): Promise<RunResult> {
  let text = prompt;
  let planning: PlanningState | null = null;
  let history: ChatMessage[] = [];
  let result: RunResult | null = null;
  const hub = new ToolHub([
    createBuiltinProvider(new MemoryStore(), () => new Date()),
    createComposioProvider({ slugsForUser: async () => slugs }),
  ]);
  const store = new MemoryStore();
  for (let turn = 0; turn < 4; turn++) {
    const started = Date.now();
    result = await runTurn(
      {
        userId,
        conversationId: `smoke-${prompt.slice(0, 24)}`,
        taskId: "smoke",
        text,
        trigger: "chat",
        history,
        facts: [],
        episodes: [],
        chunks: [],
        connections: [],
        ownerEmail: "owner@example.com",
        quota: { dailySpendUsd: 0, dailyLimitUsd: 2, recentTurns: 0, recentLimit: 20 },
        planning,
      },
      {
        model: createModelClient(),
        hub,
        store,
        now: () => new Date(),
        searchCatalog: (queries) => searchSessionCatalog(composio, userId, queries),
        lookupToolkits: (name) => searchToolkitsByName(composio, name),
        budgets: { deadlineMs: TURN_MS },
      }
    );
    const elapsed = Date.now() - started;
    const tools = [...planSteps(result).map((step) => step.tool), ...result.trace.map((entry) => entry.tool)];
    console.log("turn", JSON.stringify({ ms: elapsed, stop: result.stopReason, tools, question: result.question?.prompt ?? null, reply: result.reply.slice(0, 180) }));
    if (elapsed >= TURN_MS) fail(`turn took ${elapsed}ms: ${prompt}`);
    if (result.trace.some((entry) => isWebSearchTool(entry.tool)) || /\bweb search\b/i.test(result.reply)) fail(`${prompt} used web search`);
    history = [...history, { role: "user", content: text }, { role: "assistant", content: result.reply }];
    if (result.trace.some((entry) => entry.tool === "GMAIL_FETCH_EMAILS" && entry.ok)) break;
    if (result.proposal?.mapped?.length && !result.question) break;
    if (result.stopReason === "WAITING_APPROVAL") break;
    if (!result.question) break;
    seenQuestions?.push(`${result.question.prompt} ${(result.question.choices ?? []).join(", ")}`);
    if (stopOnQuestion) break;
    const choices = result.question.choices ?? [];
    const answer = choices.find((choice) => prefer.some((hint) => new RegExp(`\\b${hint}\\b`, "i").test(choice))) ?? choices[0] ?? freeText;
    text = answer;
    planning = result.planning;
  }
  if (!result) throw new Error("no turn");
  return result;
}

async function replaySaved(composio: Composio, userId: string, slugs: string[], workflow: WorkflowOffer): Promise<RunResult> {
  const text = `${savedStepsLine(workflow.steps)}\n${replayPrompt(workflow)}`;
  const started = Date.now();
  const result = await runTurn(
    {
      userId,
      conversationId: "smoke-replay",
      taskId: "smoke-replay",
      text,
      trigger: "schedule",
      history: [],
      facts: [],
      episodes: [],
      chunks: [],
      connections: [],
      ownerEmail: "owner@example.com",
      quota: { dailySpendUsd: 0, dailyLimitUsd: 2, recentTurns: 0, recentLimit: 20 },
      preapprovedExternal: false,
    },
    {
      model: createModelClient(),
      hub: new ToolHub([createBuiltinProvider(new MemoryStore(), () => new Date()), createComposioProvider({ slugsForUser: async () => slugs })]),
      store: new MemoryStore(),
      now: () => new Date(),
      searchCatalog: (queries) => searchSessionCatalog(composio, userId, queries),
      budgets: { deadlineMs: TURN_MS },
    }
  );
  const elapsed = Date.now() - started;
  const tools = [...planSteps(result).map((step) => step.tool), ...result.trace.map((entry) => entry.tool)];
  console.log("replay", JSON.stringify({ ms: elapsed, stop: result.stopReason, tools, reply: result.reply.slice(0, 180) }));
  if (elapsed >= TURN_MS) fail(`saved replay took ${elapsed}ms`);
  if (result.trace.some((entry) => isWebSearchTool(entry.tool)) || /\bweb search\b/i.test(result.reply)) fail("saved replay used web search");
  if (result.question) fail(`saved replay asked a question: ${result.question.prompt}`);
  return result;
}

async function main(): Promise<void> {
  const composio = new Composio({ apiKey: key });
  const actor = await actingUser(composio);

  const canvasQuestions: string[] = [];
  const vague = await chat(composio, actor.userId, actor.slugs, "Summarise what I've done on canvas into Notion", ["Canvas"], "Canvas", false, canvasQuestions);
  if (!canvasQuestions.some((question) => /\bcanvas\b/i.test(question) && /\bcanva\b/i.test(question))) {
    fail(`vague canvas request did not ask Canvas or Canva: ${canvasQuestions.join(" | ") || vague.reply.slice(0, 160)}`);
  }
  const vagueSteps = planSteps(vague);
  const canvasRead = vagueSteps.some((step) => isToolkit(step, "canvas", "canvas") && /LIST|FETCH|GET|READ/i.test(step.tool));
  const notionWrite = vagueSteps.some((step) => isToolkit(step, "notion", "notion") && /CREATE|ADD|INSERT|UPDATE/i.test(step.tool));
  if (!canvasRead || !notionWrite) {
    fail(`canvas into Notion is missing a step after choosing Canvas: ${vagueSteps.map((step) => `${step.toolkit}:${step.tool}`).join(", ") || "none"}`);
  }

  const unread = await chat(composio, actor.userId, actor.slugs, "Show my unread emails", ["gmail"], "my inbox");
  if (!unread.trace.some((entry) => entry.tool === "GMAIL_FETCH_EMAILS" && entry.ok)) {
    fail(`unread email did not execute GMAIL_FETCH_EMAILS: ${unread.trace.map((entry) => entry.tool).join(", ") || unread.reply.slice(0, 160)}`);
  } else {
    const offer = workflowOffer({ request: "Show my unread emails", trace: unread.trace, proposal: unread.proposal });
    if (!offer) fail("unread email succeeded but cannot be saved as an agent");
    else {
      const saved = { ...offer, cadence: "manual" as const };
      const again = await replaySaved(composio, actor.userId, actor.slugs, saved);
      if (!again.trace.some((entry) => entry.tool === "GMAIL_FETCH_EMAILS" && entry.ok)) {
        fail(`saved agent run did not execute GMAIL_FETCH_EMAILS: ${again.trace.map((entry) => entry.tool).join(", ") || again.reply.slice(0, 160)}`);
      }
    }
  }

  const bridge = await chat(composio, actor.userId, actor.slugs, "Get the latest YouTube video and post it to a Telegram channel", ["telegram", "youtube"], "my channel");
  const bridgeSteps = planSteps(bridge);
  if (!bridgeSteps.some((step) => isToolkit(step, "telegram", "telegram") && /SEND|POST|MESSAGE/i.test(step.tool))) {
    fail(`YouTube to Telegram plan has no Telegram send: ${bridgeSteps.map((step) => `${step.toolkit}:${step.tool}`).join(", ") || "none"}`);
  }

  const board = await chat(composio, actor.userId, actor.slugs, "Turn tomorrow's Google Calendar events into Trello cards", ["calendar", "trello"], "tomorrow's events");
  const boardSteps = planSteps(board);
  const calendar = boardSteps.some((step) => isToolkit(step, "googlecalendar", "google calendar") && /LIST|FETCH|GET|EVENT/i.test(step.tool));
  const trello = boardSteps.some((step) => isToolkit(step, "trello", "trello") && /CREATE|ADD|CARD/i.test(step.tool));
  if (!calendar || !trello) {
    fail(`Calendar to Trello plan is missing a step: ${boardSteps.map((step) => `${step.app}/${step.toolkit}:${step.tool}`).join(", ") || "none"}`);
  }
  if (board.approval?.tool === "builtin.routines.create" || boardSteps.some((step) => step.tool === "builtin.routines.create")) {
    fail("Calendar to Trello was turned into a routine");
  }

  const video = await chat(composio, actor.userId, actor.slugs, "Make me a 5 minute animated video with characters about my product", ["video"], "a product demo");
  const videoTools = [...planSteps(video).map((step) => step.tool), ...video.trace.map((entry) => entry.tool)];
  if (!videoTools.some((tool) => isVideoGeneration(tool))) {
    fail(`video plan is not a video-generation action: ${videoTools.join(", ") || "none"}`);
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
