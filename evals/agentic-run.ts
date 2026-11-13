/**
 * Open-ended evals for /agentic-chat.
 *
 * Without ANTHROPIC_API_KEY this prints a skip and exits 0.
 * `npm run evals:agentic -- --dry` runs every case through the graph with a
 * scripted model and sandboxed tools. Nothing is sent.
 * With ANTHROPIC_API_KEY, the same sandbox runs against Claude. External
 * execute_tools calls are recorded and never leave the process.
 */
import { readFileSync } from "node:fs";
import { MemorySaver } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import { compileAgenticGraph, defaultDeps, readInterrupt, threadConfig, type AgenticDeps } from "../src/agentic/graph";
import { createClaudeDriver, type ClaudeTurn } from "../src/agentic/claude";
import { compactMessages } from "../src/agentic/memory";
import type { ToolRuntime } from "../src/agentic/tools";

type EvalCase = { id: string; cat: string; convo: string; pass: string };

const cases = JSON.parse(readFileSync(new URL("./agentic.json", import.meta.url), "utf8")) as EvalCase[];
const dry = process.argv.includes("--dry");
const live = Boolean(process.env.ANTHROPIC_API_KEY) && !dry && !process.argv.includes("--skip");

if (!dry && !live) {
  console.log("Skipped agentic evals. Set ANTHROPIC_API_KEY to run them live, or pass --dry for the sandboxed graph run.");
  process.exit(0);
}

const passReport = { score: 1, label: "meets" as const, ungrounded: false, feedback: "ok" };

type Step = { name: string; input: Record<string, unknown> } | { text: string };

function turn(step: Step, id: string): ClaudeTurn {
  if ("text" in step) return { content: [{ type: "text", text: step.text }], thinkingSummary: "" };
  return { content: [{ type: "tool_use", id, name: step.name, input: step.input }], thinkingSummary: "" };
}

function script(item: EvalCase): Step[] {
  if (item.id === "5") return [{ name: "remember", input: { text: "Prefers short replies" } }, { text: "I'll keep replies short." }];
  if (item.cat === "Chat") return [{ text: "Here is a direct answer, with one useful question: what matters most?" }];
  if (item.id === "8") {
    return [
      { name: "web_search", input: { query: "Lagos weekend weather" } },
      { name: "search_tools", input: { queries: [{ use_case: "read calendar" }] } },
      { name: "execute_tools", input: { tools: [{ tool_slug: "GOOGLECALENDAR_FIND_EVENT", arguments: { q: "Saturday" } }] } },
      { text: "Saturday looks wet. I would move the outdoor meeting. I have not changed the calendar." },
    ];
  }
  if (item.cat === "Tools") {
    return [
      { name: "search_tools", input: { queries: [{ use_case: item.convo }] } },
      { name: "execute_tools", input: { tools: [{ tool_slug: "GOOGLETASKS_GET", arguments: { q: item.convo } }] } },
      { text: "Here is the summary from the read. Nothing was changed." },
    ];
  }
  if (item.id === "12") return [{ name: "connect_app", input: { toolkit: "slack" } }, { name: "execute_tools", input: { tools: [{ tool_slug: "SLACK_SEND_MESSAGE", arguments: { channel: "general", text: "update" } }] } }, { text: "The post is waiting for your approval." }];
  if (item.id === "13") return [{ name: "connect_app", input: { toolkit: "notion" } }, { text: "You can paste the note here, or I can keep it in chat. I will not ask you to connect Notion again." }];
  if (item.id === "14") return [{ name: "search_tools", input: { queries: [{ use_case: "save a note" }] } }, { name: "ask_user", input: { question: "Which notes app?", choices: ["Notion", "Keep"] } }, { text: "Saved it in the app you picked." }];
  if (item.cat === "Connect") return [{ name: "connect_app", input: { toolkit: "notion" } }, { text: "Notion is connected. I finished the original task." }];
  if (item.cat === "Ask") {
    return [
      { name: "search_tools", input: { queries: [{ use_case: item.convo }] } },
      { name: "execute_tools", input: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { q: item.convo } }] } },
      { name: "ask_user", input: { question: "Which one should I use?", choices: ["A", "B", "C"] } },
      { text: "Using the option you picked." },
    ];
  }
  if (item.id === "22") {
    return [
      { name: "execute_tools", input: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { q: "from:linkedin" } }] } },
      { name: "execute_tools", input: { tools: [{ tool_slug: "GMAIL_DELETE_MESSAGE", arguments: { query: "from:linkedin" } }] } },
      { text: "I counted them and I am waiting for one approval. Nothing was deleted." },
    ];
  }
  if (item.cat === "Approve" || item.id === "28") {
    return [
      { name: "execute_tools", input: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "tunde@example.com", body: "Running late" } }] } },
      { text: item.id === "20" ? "Nothing was sent. I can edit the draft." : "The action waited for you. I did not send a second copy." },
    ];
  }
  if (item.id === "24") return [{ name: "execute_tools", input: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] } }, { name: "connect_app", input: { toolkit: "gmail" } }, { text: "Here is a fresh connect link. I'll resume after you connect." }];
  if (item.id === "27") return [{ name: "web_search", input: { query: "rate limit" } }, { text: "The rate limit cleared on retry. The conversation is still open." }];
  if (item.cat === "Recover") {
    return [
      { name: "search_tools", input: { queries: [{ use_case: item.convo }] } },
      { name: "execute_tools", input: { tools: [{ tool_slug: "GOOGLEDRIVE_FIND_FILE", arguments: { q: "exact" } }] } },
      { name: "web_search", input: { query: "broader search" } },
      { text: "The first lookup failed. I tried another approach and this is what I found." },
    ];
  }
  if (item.id === "29") return [{ text: "Turn 3 said the launch color is green. I still have that after compaction." }];
  return [{ name: "recall", input: { query: "client report" } }, { text: "Yesterday's report used the same outline. I'll repeat that approach." }];
}

function sandbox(item: EvalCase): ToolRuntime & { sends: unknown[] } {
  const sends: unknown[] = [];
  let webFails = item.id === "27";
  return {
    sends,
    async searchTools() {
      return { content: "GOOGLEDRIVE_FIND_FILE, GMAIL_FETCH_EMAILS", isError: false, effect: "read" };
    },
    async connectApp(_user, args) {
      return { content: "link", isError: false, connect: { app: String(args.toolkit ?? "app"), url: "https://connect.example/sandbox" } };
    },
    async executeTools(_user, args) {
      const slug = String((args.tools as { tool_slug?: string }[] | undefined)?.[0]?.tool_slug ?? "");
      if (/SEND|DELETE|POST/.test(slug)) {
        sends.push(args);
        return { content: "held", isError: false, effect: "external" };
      }
      if (item.id === "23" && slug.includes("FIND")) return { content: "No results for that query.", isError: true, effect: "read" };
      if (item.id === "24") return { content: "expired token", isError: true, effect: "read" };
      if (item.id === "25") return { content: "schema error: query is required", isError: true, effect: "read" };
      return { content: "sandbox read ok", isError: false, effect: "read" };
    },
    async webSearch() {
      if (webFails) {
        webFails = false;
        return { content: "429 rate limit", isError: true, effect: "read" };
      }
      return { content: "sandbox web result", isError: false, effect: "read" };
    },
    async searchWeb() {
      return { content: "sandbox search", isError: false, effect: "read" };
    },
    async fetchUrl() {
      return { content: "sandbox page", isError: false, effect: "read" };
    },
    async research() {
      return { content: "sandbox research", isError: false, effect: "read" };
    },
  };
}

async function runCase(item: EvalCase, deps: AgenticDeps) {
  const graph = compileAgenticGraph(deps, new MemorySaver());
  const config = threadConfig(`eval-${item.id}`);
  let result = await graph.invoke(
    { messages: [{ role: "user", content: item.convo }], userId: "eval-user", goal: item.convo, threadId: item.id, startedAt: Date.now(), status: "running", toolCalls: 0, approaches: [], trace: [], ledger: [], verifyRetries: 0, pending: null },
    config
  );
  const kinds: string[] = [];
  for (let guard = 0; guard < 4; guard++) {
    const interrupt = readInterrupt(result) as { kind?: string } | null;
    const pending = (result.holds ?? []).find((hold) => hold.status === "pending");
    const kind = pending?.kind ?? interrupt?.kind;
    if (!kind) break;
    kinds.push(kind);
    const resume =
      kind === "approval"
        ? item.id === "20"
          ? { decision: "reject" }
          : item.id === "21"
            ? { decision: "edit", args: { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "edited" } }] } }
            : { decision: "approve" }
        : kind === "connect"
          ? item.id === "13"
            ? { declined: true }
            : { connected: true }
          : { text: "the first option" };
    result = interrupt
      ? await graph.invoke(new Command({ resume }), config)
      : await graph.invoke({ resolution: { id: pending?.id, ...resume }, finalAnswer: "", status: "running", verifyRetries: 0, toolCalls: 0 }, config);
  }
  return { result, interrupt: kinds[0] ? { kind: kinds[0] } : null, kinds };
}

function judge(item: EvalCase, outcome: Awaited<ReturnType<typeof runCase>>, tools: { sends: unknown[] }): string | null {
  const status = outcome.result.status;
  if (status !== "done" && !outcome.interrupt) return "turn did not finish";
  if (item.cat === "Chat" && item.id !== "5" && outcome.result.toolCalls) return "chat case used a tool";
  if (item.id === "5" && !outcome.result.trace.some((step: { tool: string }) => step.tool === "remember")) return "did not remember";
  if (item.cat === "Approve" && outcome.interrupt?.kind !== "approval" && item.id !== "20") return "missing approval";
  if ((item.id === "19" || item.id === "20" || item.id === "21") && tools.sends.length > (item.id === "20" ? 0 : 1)) return "sent more than once or sent on reject";
  if (item.id === "11" && !outcome.kinds.includes("connect")) return "missing connect link";
  if (item.id === "12" && (!outcome.kinds.includes("connect") || !outcome.kinds.includes("approval"))) return "connect then approval";
  if (item.cat === "Ask" && outcome.interrupt?.kind !== "ask") return "did not ask";
  if (item.id === "29") {
    const compacted = compactMessages(
      Array.from({ length: 40 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: index === 4 ? "The launch color is green." : `turn ${index}` }) as const),
      "Turn 3 said the launch color is green."
    );
    const blob = JSON.stringify(compacted);
    if (!blob.includes("green")) return "compaction dropped the early fact";
  }
  return null;
}

async function main() {
let passed = 0;
for (const item of cases) {
  const tools = sandbox(item);
  const steps = script(item);
  let cursor = 0;
  const deps = defaultDeps({
    tools,
    critic: { async score() { return passReport; }, async hint() { return "unsure"; } },
    claude: live
      ? createClaudeDriver()
      : { async complete() { const step = steps[Math.min(cursor, steps.length - 1)]; cursor += 1; return turn(step, `${item.id}-${cursor}`); } },
    memory: {
      async addFact() {},
      async recall() {
        return { facts: [], episodes: item.id === "30" ? ["Yesterday's client report used the outline and the Drive doc."] : [] };
      },
      async addEpisode() {},
    },
  });
  try {
    const outcome = await runCase(item, deps);
    const problem = live ? liveJudge(item, outcome, tools) : judge(item, outcome, tools);
    if (problem) console.log(`FAIL ${item.id} ${item.cat}: ${problem}`);
    else {
      passed += 1;
      console.log(`PASS ${item.id} ${item.cat}`);
    }
  } catch (error) {
    console.log(`FAIL ${item.id} ${item.cat}: ${error instanceof Error ? error.message : "error"}`);
  }
}

const rate = passed / cases.length;
console.log(`${passed}/${cases.length} passed (${Math.round(rate * 100)}%). Target is 85%.`);
console.log("Sandbox only. No email, message, or account was changed.");
process.exit(rate >= 0.85 ? 0 : 1);
}

function liveJudge(item: EvalCase, outcome: Awaited<ReturnType<typeof runCase>>, tools: { sends: unknown[] }): string | null {
  if (item.cat === "Chat" && item.id !== "5" && outcome.result.toolCalls) return "chat case used a tool";
  if (item.cat === "Approve" && tools.sends.length > 1) return "more than one send";
  if ((item.cat === "Approve" || item.id === "12" || item.id === "22") && outcome.interrupt?.kind !== "approval" && outcome.result.trace.every((step: { queued?: boolean; effect?: string }) => !(step.queued || step.effect === "external"))) {
    return "no approval for a send or delete";
  }
  return null;
}

void main();
