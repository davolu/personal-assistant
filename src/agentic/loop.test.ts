import assert from "node:assert/strict";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { Command, compileAgenticGraph, defaultDeps, readInterrupt, threadConfig, type AgenticDeps, type ComputerRunner } from "./graph";
import type { ClaudeDriver, ClaudeTurn } from "./claude";
import type { ToolRuntime } from "./tools";
import type { ToolUseBlock, VerifyReport } from "./types";
import { memoryMemoryStore } from "./memory";

function textTurn(text: string): ClaudeTurn {
  return { content: [{ type: "text", text }], thinkingSummary: "" };
}

function toolTurn(name: string, input: Record<string, unknown>, id = `call-${name}-${Math.random().toString(16).slice(2, 8)}`): ClaudeTurn {
  const block: ToolUseBlock = { type: "tool_use", id, name, input };
  return { content: [block], thinkingSummary: `Using ${name}` };
}

function scripted(steps: ClaudeTurn[]): ClaudeDriver & { calls: number } {
  const driver = {
    calls: 0,
    async complete(): Promise<ClaudeTurn> {
      const step = steps[Math.min(driver.calls, steps.length - 1)];
      driver.calls += 1;
      return step;
    },
  };
  return driver;
}

function critic(reports: VerifyReport[]) {
  let n = 0;
  return {
    async score(): Promise<VerifyReport> {
      const report = reports[Math.min(n, reports.length - 1)];
      n += 1;
      return report;
    },
    async hint() {
      return "unsure" as const;
    },
  };
}

const pass: VerifyReport = { score: 1, label: "meets", ungrounded: false, feedback: "ok" };

function deps(partial: Partial<AgenticDeps>): AgenticDeps {
  return defaultDeps({ memory: memoryMemoryStore(), ...partial });
}

async function run(partial: Partial<AgenticDeps>, text: string, resume?: unknown) {
  const graph = compileAgenticGraph(deps(partial), new MemorySaver());
  const config = threadConfig(`thread-${Math.random()}`);
  const first = await graph.invoke(
    { messages: [{ role: "user", content: text }], userId: "user-1", goal: text, threadId: "t", startedAt: Date.now(), status: "running" },
    config
  );
  if (resume === undefined || !readInterrupt(first)) return { first, done: first, graph, config };
  const done = await graph.invoke(new Command({ resume }), config);
  return { first, done, graph, config };
}

function answer(state: { finalAnswer?: string }): string {
  return state.finalAnswer ?? "";
}

test("plain chat does not call tools", async () => {
  const claude = scripted([textTurn("Let's think it through. What is the hardest part of the launch?")]);
  const tools = recordingTools();
  const { done } = await run({ claude, tools, critic: critic([pass]) }, "I'm stressed about my launch");
  assert.equal(readInterrupt(done), null);
  assert.match(answer(done), /hardest part/);
  assert.equal(tools.calls.length, 0);
  assert.equal(done.status, "done");
});

test("a tool error is returned and the agent tries something else", async () => {
  const claude = scripted([
    toolTurn("web_search", { query: "contract from Kemi" }, "search-1"),
    toolTurn("web_search", { query: "Kemi contract drive" }, "search-2"),
    textTurn("I didn't find it in the first search. A wider search found the contract."),
  ]);
  const queries: string[] = [];
  const tools = recordingTools({
    async webSearch(_userId, query) {
      queries.push(query);
      if (query === "contract from Kemi") return { content: "No results for that query.", isError: true, effect: "read" };
      return { content: "Found contract.pdf", isError: false, effect: "read" };
    },
  });
  const { done } = await run({ claude, tools, critic: critic([pass]) }, "Find the contract Kemi sent me");
  assert.deepEqual(queries, ["contract from Kemi", "Kemi contract drive"]);
  assert.match(answer(done), /wider search/);
  assert.equal(done.status, "done");
});

test("connect_app pauses with a link and resumes the same task", async () => {
  const claude = scripted([
    toolTurn("connect_app", { toolkit: "notion" }, "connect-1"),
    textTurn("Notion is connected. I can add the rent task now."),
  ]);
  const tools = recordingTools({
    async connectApp() {
      return { content: "link", isError: false, connect: { app: "notion", url: "https://connect.example/notion" } };
    },
  });
  const { first, done } = await run({ claude, tools, critic: critic([pass]) }, "Add pay rent to my Notion list", { connected: true });
  const paused = readInterrupt(first) as { kind?: string; url?: string };
  assert.equal(paused.kind, "connect");
  assert.equal(paused.url, "https://connect.example/notion");
  assert.match(answer(done), /connected/i);
  assert.equal(done.status, "done");
});

test("ask_user pauses and resumes with the answer", async () => {
  const claude = scripted([
    toolTurn("ask_user", { question: "Which John?", choices: ["John Ade", "John B", "John C"] }, "ask-1"),
    textTurn("I'll email John Ade."),
  ]);
  const { first, done } = await run({ claude, tools: recordingTools(), critic: critic([pass]) }, "Email John the proposal", { text: "John Ade" });
  const paused = readInterrupt(first) as { kind?: string; question?: string; choices?: string[] };
  assert.equal(paused.kind, "ask");
  assert.equal(paused.question, "Which John?");
  assert.deepEqual(paused.choices, ["John Ade", "John B", "John C"]);
  assert.match(answer(done), /John Ade/);
});

test("an approval gate blocks a send until the user decides", async () => {
  let executions = 0;
  const claude = scripted([
    toolTurn("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "tunde@example.com", body: "I'll be 10 minutes late" } }] }, "send-1"),
    textTurn("I did not send the email. I can edit it if you want."),
  ]);
  const tools = recordingTools({
    async executeTools() {
      executions += 1;
      return { content: "sent", isError: false, effect: "external" };
    },
  });
  const { first, done } = await run({ claude, tools, critic: critic([pass]) }, "Email Tunde that I'll be late", { decision: "reject" });
  const paused = readInterrupt(first) as { kind?: string; args?: { tools?: { tool_slug?: string }[] } };
  assert.equal(paused.kind, "approval");
  assert.equal(paused.args?.tools?.[0]?.tool_slug, "GMAIL_SEND_EMAIL");
  assert.equal(executions, 0);
  assert.match(answer(done), /did not send/);
  assert.equal(executions, 0);
});

test("a low Jev score sends the agent back once", async () => {
  const claude = scripted([textTurn("I sent the email."), textTurn("I have not sent the email. It is waiting if you want it sent.")]);
  const reports: VerifyReport[] = [
    { score: 0, label: "fails", ungrounded: true, feedback: "You claimed a send that is not in the trace." },
    pass,
  ];
  const { done } = await run({ claude, critic: critic(reports) }, "Email Tunde");
  assert.match(answer(done), /have not sent/);
  assert.equal(done.verifyRetries, 1);
  assert.equal(done.ungrounded, false);
});

test("use_computer is a tool the model can choose, and a desktop error does not end the turn", async () => {
  const tasks: string[] = [];
  const computer: ComputerRunner = {
    async run({ task }) {
      tasks.push(task);
      return { status: "error", message: "The desktop browser failed to open." };
    },
  };
  const claude = scripted([
    toolTurn("use_computer", { task: "Open the venue page" }, "desk-1"),
    toolTurn("web_search", { query: "venue page" }, "web-1"),
    textTurn("The desktop failed, so I searched the web instead."),
  ]);
  const { done } = await run({ claude, computer, tools: recordingTools(), critic: critic([pass]) }, "Check the venue page");
  assert.deepEqual(tasks, ["Open the venue page"]);
  assert.match(answer(done), /searched the web/);
  assert.equal(done.status, "done");
});

test("desktop takeover pauses on ask_user and then continues", async () => {
  let resumed = false;
  const computer: ComputerRunner = {
    async run({ resume }) {
      if (!resume) {
        return {
          status: "ask",
          question: "Captcha on the site. Take over the desktop, then continue.",
          choices: [],
          checkpoint: { task: "Open the bank site", messages: [], stepsUsed: 1 },
          streamUrl: "https://stream.example/desktop",
          sandboxId: "sbx-1",
        };
      }
      resumed = true;
      return { status: "done", summary: "Continued after you cleared the captcha.", streamUrl: "https://stream.example/desktop", sandboxId: "sbx-1" };
    },
  };
  const claude = scripted([
    toolTurn("use_computer", { task: "Open the bank site" }, "desk-2"),
    textTurn("You cleared the captcha and I finished the task."),
  ]);
  const { first, done } = await run({ claude, computer, critic: critic([pass]) }, "Open the bank site", { text: "Done, continue" });
  const paused = readInterrupt(first) as { kind?: string; question?: string };
  assert.equal(paused.kind, "ask");
  assert.match(paused.question ?? "", /Captcha/);
  assert.equal(resumed, true);
  assert.equal(done.computerStream, "https://stream.example/desktop");
  assert.match(answer(done), /captcha/i);
});

function recordingTools(overrides: Partial<ToolRuntime> = {}): ToolRuntime & { calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const record = (name: string, args: Record<string, unknown>) => calls.push({ name, args });
  return {
    calls,
    async searchTools(_user, args) {
      record("search_tools", args);
      return { content: "GMAIL_FETCH_EMAILS", isError: false, effect: "read" };
    },
    async connectApp(_user, args) {
      record("connect_app", args);
      return { content: "already connected", isError: false };
    },
    async executeTools(_user, args) {
      record("execute_tools", args);
      return { content: "ok", isError: false, effect: "read" };
    },
    async webSearch(_user, query) {
      record("web_search", { query });
      return { content: `results for ${query}`, isError: false, effect: "read" };
    },
    async research(_user, goal) {
      record("research", { goal });
      return { content: `notes on ${goal}`, isError: false, effect: "read" };
    },
    ...overrides,
  };
}
