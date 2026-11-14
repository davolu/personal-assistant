import assert from "node:assert/strict";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";
import { readBudgets } from "./budgets";
import { Command, compileAgenticGraph, computerSlicePending, defaultDeps, followComputerSlices, readInterrupt, threadConfig, type AgenticDeps, type ComputerRunner } from "./graph";
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

test("use_computer returns the final screenshot as an image in the tool result", async () => {
  const claude = scripted([
    toolTurn("use_computer", { task: "Open the top story" }, "desk-img"),
    textTurn("The browser is on the story, and Enter was not pressed."),
  ]);
  const computer: ComputerRunner = {
    async run() {
      return {
        status: "done",
        summary: "Stopped because the computer step budget was reached. Last action: typed the story URL.",
        screenshot: "aW1hZ2U=",
        url: "https://news.ycombinator.com/",
        title: "Hacker News — Mozilla Firefox",
      };
    },
  };
  const { done } = await run({ claude, computer, critic: critic([pass]) }, "Open the top story on Hacker News");
  const toolMessage = done.messages.find((message) => Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result"));
  assert.ok(toolMessage && Array.isArray(toolMessage.content));
  const result = toolMessage.content.find((block) => block.type === "tool_result");
  assert.equal(result?.type, "tool_result");
  if (!result || result.type !== "tool_result" || !Array.isArray(result.content)) return;
  const text = result.content.find((part) => part.type === "text");
  const image = result.content.find((part) => part.type === "image");
  assert.equal(text?.type, "text");
  assert.match(text && text.type === "text" ? text.text : "", /computer step budget/);
  assert.match(text && text.type === "text" ? text.text : "", /Window: Hacker News — Mozilla Firefox/);
  assert.match(text && text.type === "text" ? text.text : "", /URL: https:\/\/news\.ycombinator\.com\//);
  assert.equal(image?.type, "image");
  if (image?.type === "image") assert.equal(image.source.data, "aW1hZ2U=");
  assert.match(answer(done), /Enter was not pressed/);
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

test("a desktop slice reports the stream before the tool result, and the next invoke finishes the call", async () => {
  const events: { type: string; name?: string; status?: string; streamUrl?: string }[] = [];
  let runs = 0;
  const computer: ComputerRunner = {
    async run(input) {
      runs += 1;
      input.onDesktop?.({ streamUrl: "https://stream.example/hn", sandboxId: "sbx-hn" });
      if (!input.checkpoint) {
        return {
          status: "continue",
          summary: "The desktop is still working.",
          streamUrl: "https://stream.example/hn",
          sandboxId: "sbx-hn",
          checkpoint: { task: input.task, messages: [{ role: "user", content: input.task }], stepsUsed: 4 },
        };
      }
      return {
        status: "done",
        summary: "Opened Hacker News.",
        screenshot: "aW1hZ2U=",
        streamUrl: "https://stream.example/hn",
        sandboxId: "sbx-hn",
        url: "https://news.ycombinator.com/",
        title: "Hacker News",
      };
    },
  };
  const claude = scripted([
    toolTurn("use_computer", { task: "Open Hacker News" }, "desk-slice"),
    textTurn("Hacker News is open in the desktop browser."),
  ]);
  const graph = compileAgenticGraph(
    deps({
      claude,
      computer,
      critic: critic([pass]),
      onEvent: (event) => {
        if (event.type === "computer") events.push({ type: event.type, streamUrl: event.streamUrl });
        if (event.type === "tool") events.push({ type: event.type, name: event.name, status: event.status });
      },
    }),
    new MemorySaver()
  );
  const config = threadConfig("computer-slice");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Open Hacker News" }],
      userId: "user-1",
      goal: "Open Hacker News",
      threadId: "computer-slice",
      startedAt: Date.now(),
      status: "running",
      resolution: null,
    },
    config
  );
  assert.equal(computerSlicePending(first), true);
  assert.equal(first.computerStream, "https://stream.example/hn");
  assert.equal(events.some((event) => event.type === "computer" && event.streamUrl === "https://stream.example/hn"), true);
  assert.equal(events.filter((event) => event.name === "use_computer" && event.status === "start").length, 1);
  assert.equal(events.filter((event) => event.name === "use_computer" && event.status === "ok").length, 0);
  const done = await graph.invoke({ status: "running", finalAnswer: "", resolution: null }, config);
  assert.equal(runs, 2);
  assert.equal(done.status, "done");
  assert.match(answer(done), /Hacker News is open/);
  assert.equal(events.filter((event) => event.name === "use_computer" && event.status === "ok").length, 1);
  const toolMessage = done.messages.find((message) => Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result" && block.tool_use_id === "desk-slice"));
  assert.ok(toolMessage);
});

test("desktop slices stop when the request window is used up and resume while it remains", async () => {
  const pending = {
    phase: "resume-computer" as const,
    computer: { task: "Open Hacker News", messages: [], stepsUsed: 1 },
    kind: "ask" as const,
    toolUseId: "desk",
    siblingResults: [],
    order: ["desk"],
  };
  let blocked = 0;
  const stopped = await followComputerSlices(
    { status: "computer_continue", pending },
    async () => {
      blocked += 1;
      return { status: "computer_continue", pending };
    },
    { startedAt: 0, now: () => 0, requestMs: 0 }
  );
  assert.equal(blocked, 0);
  assert.equal(stopped.status, "computer_continue");

  let calls = 0;
  const finished = await followComputerSlices(
    { status: "computer_continue", pending },
    async () => {
      calls += 1;
      if (calls < 2) return { status: "computer_continue", pending };
      return { status: "done", pending: null };
    },
    { startedAt: 0, now: () => 1_000, requestMs: 200_000 }
  );
  assert.equal(calls, 2);
  assert.equal(finished.status, "done");
});

test("answering the approach question resets the budget and the agent continues", async () => {
  let calls = 0;
  const toolEvents: string[] = [];
  const claude: ClaudeDriver = {
    async complete() {
      calls += 1;
      if (calls === 1) return toolTurn("use_computer", { task: "Open Hacker News" }, "desk-a");
      if (calls === 2) return toolTurn("fetch_url", { url: "https://news.ycombinator.com" }, "fetch-a");
      if (calls === 3) return toolTurn("web_search", { query: "hacker news" }, "search-a");
      if (calls === 4) return toolTurn("use_computer", { task: "Open Hacker News in the desktop browser" }, "desk-b");
      return textTurn("The desktop browser is on Hacker News.");
    },
  };
  const computer: ComputerRunner = {
    async run({ task }) {
      if (task === "Open Hacker News") return { status: "error", message: "The desktop browser failed to open." };
      return { status: "done", summary: "Opened Hacker News.", streamUrl: "https://stream.example/hn", sandboxId: "sbx-hn" };
    },
  };
  const tools = recordingTools({
    async fetchUrl() {
      return { content: "fetch_url timed out", isError: true, effect: "read" };
    },
    async webSearch() {
      return { content: "Web search failed", isError: true, effect: "read" };
    },
  });
  const graph = compileAgenticGraph(
    deps({
      claude,
      computer,
      tools,
      critic: critic([pass]),
      onEvent: (event) => {
        if (event.type === "tool" && event.name === "use_computer") toolEvents.push(event.status);
      },
    }),
    new MemorySaver()
  );
  const config = threadConfig("approach-answer");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Open Hacker News" }],
      userId: "user-1",
      goal: "Open Hacker News",
      threadId: "approach-answer",
      startedAt: Date.now(),
      status: "running",
      resolution: null,
      toolCalls: 0,
      approaches: [],
    },
    config
  );
  assert.equal(first.status, "ask_user");
  assert.match(first.finalAnswer ?? "", /I tried 3 approaches/);
  assert.match(first.finalAnswer ?? "", /What should I do next/);
  const hold = first.holds?.find((item) => item.approachBudget && item.status === "pending");
  assert.ok(hold);
  const done = await graph.invoke(
    { resolution: { id: hold?.id, text: "Yes, go ahead on the desktop.", decision: "Yes, go ahead on the desktop." }, finalAnswer: "", status: "running", verifyRetries: 0 },
    config
  );
  assert.equal(calls, 5);
  assert.equal(done.status, "done");
  assert.match(answer(done), /desktop browser is on Hacker News/);
  assert.doesNotMatch(answer(done), /What should I do next/);
  assert.equal(done.holds?.filter((item) => item.approachBudget).length, 1);
  assert.equal(done.holds?.find((item) => item.id === hold?.id)?.status, "resolved");
  assert.deepEqual(done.approaches, []);
  assert.deepEqual(toolEvents, ["start", "error", "start", "ok"]);
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

test("a budget answer to continue resets the window and the same run proceeds", async () => {
  let now = 10_000;
  let agentCalls = 0;
  let classified = 0;
  const claude: ClaudeDriver = {
    async complete(input) {
      if (input.system.startsWith("Classify")) {
        classified += 1;
        const text = typeof input.messages[0]?.content === "string" ? input.messages[0].content : "";
        return textTurn(/\bcancel\b|\bstop\b/i.test(text) ? "stop" : "continue");
      }
      agentCalls += 1;
      if (agentCalls === 1) return toolTurn("web_search", { query: "contract" }, "search-1");
      if (agentCalls === 2) return toolTurn("web_search", { query: "archive" }, "search-2");
      return textTurn("Found it in the archive.");
    },
  };
  const queries: string[] = [];
  const tools = recordingTools({
    async webSearch(_user, query) {
      queries.push(query);
      if (query === "contract") {
        now = 10_000 + 60_000;
        return { content: "No results.", isError: true, effect: "read" };
      }
      return { content: "Found contract.pdf", isError: false, effect: "read" };
    },
  });
  const graph = compileAgenticGraph(
    deps({ claude, tools, critic: critic([pass]), now: () => now, budgets: { ...readBudgets(), wallClockMs: 5_000, maxToolCalls: 40 } }),
    new MemorySaver()
  );
  const config = threadConfig("budget-continue");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Find the contract" }],
      userId: "user-1",
      goal: "Find the contract",
      threadId: "budget-continue",
      startedAt: 10_000,
      touchedAt: 10_000,
      activeMs: 0,
      status: "running",
      resolution: null,
      toolCalls: 0,
    },
    config
  );
  const hold = first.holds?.find((item) => item.status === "pending");
  assert.equal(hold?.budget, true);
  assert.match(hold?.question ?? "", /active time budget/);
  assert.match(hold?.question ?? "", /web_search/);
  assert.equal(hold?.options?.some((option) => option.label === "Keep going" && option.value === "continue"), true);
  assert.equal(hold?.options?.some((option) => option.label === "Stop here" && option.value === "stop"), true);
  assert.equal(hold?.allowCustom, true);
  assert.equal(first.startedAt, 0);
  assert.equal(agentCalls, 1);
  const done = await graph.invoke(
    { resolution: { id: hold?.id, text: "yes, check the archive", decision: "yes, check the archive" }, finalAnswer: "", status: "running", verifyRetries: 0 },
    config
  );
  assert.equal(classified, 1);
  assert.equal(agentCalls, 3);
  assert.deepEqual(queries, ["contract", "archive"]);
  assert.equal(done.status, "done");
  assert.match(answer(done), /archive/);
  assert.doesNotMatch(answer(done), /How should I continue/);
  assert.notEqual(done.startedAt, 10_000);
  assert.equal(done.toolCalls, 1);
  assert.equal(done.ledger?.some((entry) => entry.tool === "web_search"), true);
  assert.equal((done.approaches ?? []).length >= 1, true);
  assert.equal(done.holds?.find((item) => item.id === hold?.id)?.status, "resolved");
  const saved = await graph.getState(config);
  assert.notEqual((saved.values as { startedAt?: number }).startedAt, 10_000);
});

test("a stop answer ends the budget turn with the progress so far", async () => {
  let now = 10_000;
  let agentCalls = 0;
  const claude: ClaudeDriver = {
    async complete() {
      agentCalls += 1;
      return toolTurn("web_search", { query: "contract" }, "search-stop");
    },
  };
  const tools = recordingTools({
    async webSearch() {
      now = 10_000 + 60_000;
      return { content: "No results.", isError: true, effect: "read" };
    },
  });
  const graph = compileAgenticGraph(
    deps({ claude, tools, now: () => now, budgets: { ...readBudgets(), wallClockMs: 5_000 } }),
    new MemorySaver()
  );
  const config = threadConfig("budget-stop");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Find the contract" }],
      userId: "user-1",
      goal: "Find the contract",
      threadId: "budget-stop",
      startedAt: 10_000,
      touchedAt: 10_000,
      status: "running",
      toolCalls: 0,
    },
    config
  );
  const hold = first.holds?.find((item) => item.budget);
  const done = await graph.invoke(
    { resolution: { id: hold?.id, text: "stop", decision: "stop" }, finalAnswer: "", status: "running", verifyRetries: 0 },
    config
  );
  assert.equal(agentCalls, 1);
  assert.equal(done.status, "done");
  assert.match(answer(done), /Stopped here/);
  assert.match(answer(done), /web_search/);
  assert.doesNotMatch(answer(done), /How should I continue/);
  assert.equal(done.holds?.find((item) => item.id === hold?.id)?.resolution?.label, "Stop here");
});

test("a free-text cancel is classified by the model and ends the turn", async () => {
  let now = 10_000;
  let agentCalls = 0;
  const claude: ClaudeDriver = {
    async complete(input) {
      if (input.system.startsWith("Classify")) {
        const text = typeof input.messages[0]?.content === "string" ? input.messages[0].content : "";
        return textTurn(/\bcancel\b|\bstop\b/i.test(text) ? "stop" : "continue");
      }
      agentCalls += 1;
      return toolTurn("web_search", { query: "contract" }, "search-cancel");
    },
  };
  const tools = recordingTools({
    async webSearch() {
      now = 10_000 + 60_000;
      return { content: "No results.", isError: true, effect: "read" };
    },
  });
  const graph = compileAgenticGraph(
    deps({ claude, tools, now: () => now, budgets: { ...readBudgets(), wallClockMs: 5_000 } }),
    new MemorySaver()
  );
  const config = threadConfig("budget-cancel");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Find the contract" }],
      userId: "user-1",
      goal: "Find the contract",
      threadId: "budget-cancel",
      startedAt: 10_000,
      touchedAt: 10_000,
      status: "running",
      toolCalls: 0,
    },
    config
  );
  const hold = first.holds?.find((item) => item.budget);
  const done = await graph.invoke(
    { resolution: { id: hold?.id, text: "please cancel", decision: "please cancel" }, finalAnswer: "", status: "running", verifyRetries: 0 },
    config
  );
  assert.equal(agentCalls, 1);
  assert.match(answer(done), /Stopped here/);
  assert.equal(done.status, "done");
});

test("time spent waiting on the user is not part of the active budget", async () => {
  let now = 1_000;
  const claude = scripted([
    toolTurn("ask_user", { question: "Which John?", choices: ["A", "B"] }, "ask-wait"),
    textTurn("Waiting on which John."),
    textTurn("I'll email John A."),
  ]);
  const graph = compileAgenticGraph(
    deps({ claude, critic: critic([pass]), now: () => now, budgets: { ...readBudgets(), wallClockMs: 10 * 60 * 1000 } }),
    new MemorySaver()
  );
  const config = threadConfig("budget-wait");
  const first = await graph.invoke(
    {
      messages: [{ role: "user", content: "Email John" }],
      userId: "user-1",
      goal: "Email John",
      threadId: "budget-wait",
      startedAt: now,
      touchedAt: now,
      activeMs: 0,
      status: "running",
      toolCalls: 0,
    },
    config
  );
  const hold = first.holds?.find((item) => item.status === "pending");
  assert.equal(hold?.kind, "ask");
  assert.equal(hold?.budget, undefined);
  assert.equal(first.startedAt, 0);
  now += 30 * 60 * 1000;
  const done = await graph.invoke(
    { resolution: { id: hold?.id, text: "John A", decision: "John A" }, finalAnswer: "", status: "running", verifyRetries: 0 },
    config
  );
  assert.equal(claude.calls, 3);
  assert.match(answer(done), /John A/);
  assert.doesNotMatch(answer(done), /active time budget/);
  assert.notEqual(done.startedAt, 1_000);
});

test("repeated search queries do not ask the user while fetch_url is still unused", async () => {
  const seen: string[] = [];
  const claude = scripted([
    toolTurn("web_search", { query: "Veo 3 API pricing per second Runway Gen-4 API key" }, "s1"),
    toolTurn("web_search", { query: "Flux Kontext character consistency API pricing" }, "s2"),
    toolTurn("search_web", { query: "Veo 3 API pricing per second Runway Gen-4 API key", provider: "duckduckgo" }, "s3"),
    toolTurn("search_web", { query: "Flux Kontext character consistency API pricing", provider: "duckduckgo" }, "s4"),
    toolTurn("fetch_url", { url: "https://docs.dev.runwayml.com/guides/pricing/" }, "s5"),
    textTurn("Runway lists Gen-4 pricing on the docs page."),
  ]);
  const tools = recordingTools({
    async webSearch(_user, query) {
      seen.push(`web_search:${query}`);
      return { content: "Web search failed", isError: true, effect: "read" };
    },
    async searchWeb(_user, args) {
      seen.push(`search_web:${String(args.provider ?? "")}:${String(args.query ?? "")}`);
      return { content: "duckduckgo blocked this request.", isError: true, effect: "read" };
    },
    async fetchUrl(_user, url) {
      seen.push(`fetch_url:${url}`);
      return { content: "Gen-4 pricing", isError: false, effect: "read" };
    },
  });
  const { done } = await run({ claude, tools, critic: critic([pass]), budgets: readBudgets() }, "Find Veo and Flux API pricing");
  assert.deepEqual(seen, [
    "web_search:Veo 3 API pricing per second Runway Gen-4 API key",
    "web_search:Flux Kontext character consistency API pricing",
    "search_web:duckduckgo:Veo 3 API pricing per second Runway Gen-4 API key",
    "search_web:duckduckgo:Flux Kontext character consistency API pricing",
    "fetch_url:https://docs.dev.runwayml.com/guides/pricing/",
  ]);
  assert.equal(done.status, "done");
  assert.deepEqual(done.approaches, ["web_search", "search_web"]);
  assert.doesNotMatch(answer(done), /What should I do next/);
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
    async searchWeb(_user, args) {
      record("search_web", args);
      return { content: `search ${String(args.query ?? "")}`, isError: false, effect: "read" };
    },
    async fetchUrl(_user, url) {
      record("fetch_url", { url });
      return { content: `page ${url}`, isError: false, effect: "read" };
    },
    async research(_user, goal) {
      record("research", { goal });
      return { content: `notes on ${goal}`, isError: false, effect: "read" };
    },
    ...overrides,
  };
}
