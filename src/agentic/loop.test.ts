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
    { messages: [{ role: "user", content: text }], userId: "user-1", goal: text, threadId: "t", startedAt: Date.now(), status: "running", resolution: null },
    config
  );
  const waiting = (first.holds ?? []).find((hold) => hold.status === "pending");
  if (resume === undefined || (!readInterrupt(first) && !waiting)) return { first, done: first, graph, config };
  if (readInterrupt(first)) {
    const done = await graph.invoke(new Command({ resume }), config);
    return { first, done, graph, config };
  }
  const extra = resume && typeof resume === "object" ? (resume as Record<string, unknown>) : { text: String(resume ?? "") };
  const done = await graph.invoke(
    { resolution: { id: waiting?.id, ...extra }, finalAnswer: "", status: "running", verifyRetries: 0, toolCalls: 0 },
    config
  );
  return { first, done, graph, config };
}

function waitingHold(state: { holds?: { status: string; kind: string; url?: string; question?: string; choices?: string[]; options?: { value?: string; description?: string }[]; multiSelect?: boolean; allowCustom?: boolean; args?: { tools?: { tool_slug?: string }[] } }[] }) {
  return state.holds?.find((hold) => hold.status === "pending");
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
  const paused = waitingHold(first);
  assert.equal(paused?.kind, "connect");
  assert.equal(paused?.url, "https://connect.example/notion");
  assert.equal(readInterrupt(first), null);
  assert.match(answer(done), /connected/i);
  assert.equal(done.status, "done");
});

test("ask_user pauses and resumes with the answer", async () => {
  const claude = scripted([
    toolTurn("ask_user", { question: "Which John?", choices: ["John Ade", "John B", "John C"] }, "ask-1"),
    textTurn("I'll email John Ade."),
  ]);
  const { first, done } = await run({ claude, tools: recordingTools(), critic: critic([pass]) }, "Email John the proposal", { text: "John Ade" });
  const paused = waitingHold(first);
  assert.equal(paused?.kind, "ask");
  assert.equal(paused?.question, "Which John?");
  assert.deepEqual(paused?.choices, ["John Ade", "John B", "John C"]);
  assert.equal(readInterrupt(first), null);
  assert.match(answer(done), /John Ade/);
});

test("ask_user keeps structured options for the cards", async () => {
  const claude = scripted([
    toolTurn(
      "ask_user",
      {
        question: "Which lists?",
        options: [
          { label: "Product", value: "product", description: "Weekly" },
          { label: "Leads", value: "leads" },
        ],
        multiSelect: true,
        allowCustom: true,
      },
      "ask-2"
    ),
    textTurn("I'll use the product list."),
  ]);
  const { first, done } = await run({ claude, tools: recordingTools(), critic: critic([pass]) }, "Send the recap", { text: "product" });
  const paused = waitingHold(first);
  assert.deepEqual(paused?.choices, ["product", "leads"]);
  assert.equal(paused?.options?.[0]?.description, "Weekly");
  assert.equal(paused?.multiSelect, true);
  assert.equal(paused?.allowCustom, true);
  assert.match(answer(done), /product list/);
});

test("schedule_task pauses for approval and saves only after the user accepts", async () => {
  let saved = 0;
  const claude = scripted([
    toolTurn("schedule_task", { goal: "Check the inbox", cadence: "daily", time: "09:00", timezone: "UTC", name: "Inbox" }, "sched-1"),
    textTurn("The daily inbox check is saved."),
  ]);
  const { first, done } = await run(
    {
      claude,
      schedules: {
        async save() {
          saved += 1;
          return { ok: true, message: "Schedule saved." };
        },
      },
    },
    "Check the inbox every day at 9",
    { decision: "reject" }
  );
  const paused = waitingHold(first);
  assert.equal(paused?.kind, "approval");
  assert.match(String((paused as { summary?: string } | undefined)?.summary ?? ""), /Daily at 9:00 AM/);
  assert.equal(saved, 0);
  assert.match(answer(done), /did not save|daily inbox/i);
});

test("an approved schedule_task is saved through the generic tool", async () => {
  let goal = "";
  const claude = scripted([
    toolTurn("schedule_task", { goal: "Summarize the board", cadence: "weekdays", time: "08:30", timezone: "UTC" }, "sched-2"),
    textTurn("Saved the weekday run."),
  ]);
  const { done } = await run(
    {
      claude,
      schedules: {
        async save(input) {
          goal = String(input.args.goal ?? "");
          return { ok: true, message: "Schedule saved." };
        },
      },
    },
    "Do this on weekdays",
    { decision: "approve" }
  );
  assert.equal(goal, "Summarize the board");
  assert.match(answer(done), /Saved the weekday run/);
});

test("a schedule that explicitly allows risky actions does not wait on a send", async () => {
  let executions = 0;
  const claude = scripted([
    toolTurn("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@example.com" } }] }, "send-ok"),
    textTurn("Sent."),
  ]);
  const tools = recordingTools({
    async executeTools() {
      executions += 1;
      return { content: "sent", isError: false, effect: "external" };
    },
  });
  const graph = compileAgenticGraph(deps({ claude, tools }), new MemorySaver());
  const done = await graph.invoke(
    {
      messages: [{ role: "user", content: "Send the note" }],
      userId: "user-1",
      goal: "Send the note",
      threadId: "t",
      startedAt: Date.now(),
      status: "running",
      allowExternal: true,
    },
    threadConfig("allow-external")
  );
  assert.equal(readInterrupt(done), null);
  assert.equal(executions, 1);
  assert.match(answer(done), /Sent/);
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
  const paused = waitingHold(first);
  assert.equal(paused?.kind, "approval");
  assert.equal(paused?.args?.tools?.[0]?.tool_slug, "GMAIL_SEND_EMAIL");
  assert.equal(readInterrupt(first), null);
  assert.equal(executions, 0);
  assert.match(answer(done), /did not send/);
  assert.equal(executions, 0);
});

test("approving a waiting action runs it once and records the choice", async () => {
  let executions = 0;
  const claude = scripted([
    toolTurn("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "<p>Hello</p>" } }] }, "send-2"),
    textTurn("Waiting for your approval."),
    textTurn("The message went out."),
  ]);
  const tools = recordingTools({
    async executeTools() {
      executions += 1;
      return { content: "sent", isError: false, effect: "external" };
    },
  });
  const { first, done } = await run({ claude, tools, critic: critic([pass]) }, "Send the note", { decision: "approve" });
  assert.equal(waitingHold(first)?.status, "pending");
  assert.equal(executions, 1);
  assert.equal(done.holds?.find((hold) => hold.kind === "approval")?.status, "resolved");
  assert.equal(done.holds?.find((hold) => hold.kind === "approval")?.resolution?.label, "Approved");
  assert.match(answer(done), /went out/);
});

test("a new message leaves a pending approval in place", async () => {
  let executions = 0;
  const claude = scripted([
    toolTurn("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "Hi" } }] }, "send-3"),
    textTurn("Waiting for your approval."),
    textTurn("Tomorrow is clear."),
  ]);
  const tools = recordingTools({
    async executeTools() {
      executions += 1;
      return { content: "sent", isError: false, effect: "external" };
    },
  });
  const { first, graph, config } = await run({ claude, tools, critic: critic([pass]) }, "Send the note");
  assert.equal(waitingHold(first)?.kind, "approval");
  const next = await graph.invoke(
    {
      messages: [...first.messages, { role: "user", content: "What is the weather?" }],
      goal: "What is the weather?",
      resolution: null,
      finalAnswer: "",
      status: "running",
      verifyRetries: 0,
      toolCalls: 0,
    },
    config
  );
  assert.equal(executions, 0);
  assert.equal(waitingHold(next)?.kind, "approval");
  assert.match(answer(next), /clear/);
});

test("a ledger failure keeps the approval waiting and the thread usable", async () => {
  let executions = 0;
  const claude = scripted([
    toolTurn("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { body: "Hi" } }] }, "send-4"),
    textTurn("Waiting for your approval."),
    textTurn("Still here."),
  ]);
  const { first, done, graph, config } = await run(
    {
      claude,
      critic: critic([pass]),
      ledger: {
        async get() {
          throw new Error('column "user_id" does not exist');
        },
        async put() {},
      },
      tools: recordingTools({
        async executeTools() {
          executions += 1;
          return { content: "sent", isError: false, effect: "external" };
        },
      }),
    },
    "Send the note",
    { decision: "approve" }
  );
  assert.equal(waitingHold(first)?.kind, "approval");
  assert.equal(executions, 0);
  assert.equal(done.holds?.find((hold) => hold.kind === "approval")?.status, "pending");
  assert.match(done.holds?.find((hold) => hold.kind === "approval")?.error ?? "", /still waiting/i);
  assert.match(answer(done), /still waiting/i);
  const next = await graph.invoke(
    {
      messages: [...done.messages, { role: "user", content: "What else can you do?" }],
      goal: "What else can you do?",
      resolution: null,
      finalAnswer: "",
      status: "running",
      verifyRetries: 0,
      toolCalls: 0,
    },
    config
  );
  assert.equal(next.status, "done");
  assert.match(answer(next), /Still here/);
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
  const paused = waitingHold(first);
  assert.equal(paused?.kind, "ask");
  assert.match(paused?.question ?? "", /Captcha/);
  assert.equal(readInterrupt(first), null);
  assert.equal(resumed, true);
  assert.equal(done.computerStream, "https://stream.example/desktop");
  assert.match(answer(done), /captcha/i);
});

test("a credit guard stops before the model call and keeps the user's message", async () => {
  const claude = scripted([textTurn("This should not be sent")]);
  const { done } = await run(
    {
      claude,
      guard: {
        async beforeModel() {
          return "I stopped because this account is out of credits. Your chat is saved.";
        },
        async afterModel() {
          return null;
        },
      },
    },
    "Keep going on the recap"
  );
  assert.equal(claude.calls, 0);
  assert.match(answer(done), /out of credits/);
  assert.match(JSON.stringify(done.messages), /Keep going on the recap/);
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
