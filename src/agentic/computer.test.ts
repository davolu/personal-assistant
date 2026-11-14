import assert from "node:assert/strict";
import test from "node:test";
import { COMPUTER_STEP_BUDGET } from "./budgets";
import { actionNeedsApproval, computerToolForModel, computerToolResult, MAX_STORED_SCREENSHOT, runComputerLoop, type ComputerModel, type DesktopHandle, type NormalizedAction } from "./computer";
import { nextComputerContinue, resumeComputerCheckpoint } from "./computer-continue";
import { adoptDesktop, createDesktopManager, desktopIdleMs, desktopSandboxConfig, desktopTimeoutMs, E2B_MAX_RUNNING_MS, isMissingSandbox, memoryDesktopStore, observationFromWindowTitle, type DesktopFactory, type DesktopRecord, type DesktopSession } from "./desktop";
import type { ContentBlock, ToolUseBlock } from "./types";

function tool(name: string, input: Record<string, unknown>, id: string): ToolUseBlock {
  return { type: "tool_use", id, name, input };
}

function scripted(steps: ContentBlock[][]): ComputerModel {
  let n = 0;
  return {
    async complete() {
      const content = steps[Math.min(n, steps.length - 1)];
      n += 1;
      return { content };
    },
  };
}

function fakeDesktop(): DesktopHandle & { actions: NormalizedAction[]; shots: number } {
  const actions: NormalizedAction[] = [];
  const desktop = {
    sandboxId: "sbx-test",
    streamUrl: "https://stream.example/sbx-test",
    actions,
    shots: 0,
    async screenshot() {
      desktop.shots += 1;
      return "aW1hZ2U=";
    },
    async perform(action: NormalizedAction) {
      actions.push(action);
    },
  };
  return desktop;
}

test("computer loop screenshots, acts, and returns a summary", async () => {
  const desktop = fakeDesktop();
  const model = scripted([
    [tool("computer", { action: "screenshot" }, "s1")],
    [tool("computer", { action: "left_click", coordinate: [10, 20] }, "c1"), tool("computer", { action: "type", text: "rent" }, "t1")],
    [tool("computer", { action: "screenshot" }, "s2")],
    [{ type: "text", text: "Typed rent into the page." }],
  ]);
  const result = await runComputerLoop({ task: "Type rent into the notes site", desktop, model, maxSteps: 8 });
  assert.equal(result.status, "done");
  if (result.status === "done") {
    assert.match(result.summary, /Typed rent/);
    assert.equal(result.screenshot, "aW1hZ2U=");
  }
  assert.equal(desktop.shots, 3);
  assert.deepEqual(
    desktop.actions.map((action) => action.kind),
    ["left_click", "type"]
  );
  assert.equal(result.streamUrl, "https://stream.example/sbx-test");
});

test("computer loop hands sign-in to the user and resumes", async () => {
  const desktop = fakeDesktop();
  const model = scripted([
    [tool("computer", { action: "screenshot" }, "s1")],
    [tool("ask_user", { question: "Enter the 2FA code on the desktop." }, "ask")],
    [{ type: "text", text: "Signed in after you took over." }],
  ]);
  const first = await runComputerLoop({ task: "Open the account page", desktop, model, maxSteps: 8 });
  assert.equal(first.status, "ask");
  if (first.status !== "ask") return;
  assert.match(first.question, /2FA/);
  assert.equal(desktop.actions.length, 0);
  const second = await runComputerLoop({
    task: "Open the account page",
    desktop,
    model,
    maxSteps: 8,
    checkpoint: first.checkpoint,
    resume: { kind: "ask", text: "Code entered, continue" },
  });
  assert.equal(second.status, "done");
  if (second.status === "done") assert.match(second.summary, /Signed in/);
});

test("a desktop send waits for approval and does not run on reject", async () => {
  const desktop = fakeDesktop();
  const model = scripted([
    [{ type: "text", text: "I will submit the payment form." }, tool("computer", { action: "key", text: "Return" }, "pay")],
    [{ type: "text", text: "I did not submit it." }],
  ]);
  const first = await runComputerLoop({ task: "Pay the invoice in the browser", desktop, model, maxSteps: 6 });
  assert.equal(first.status, "approval");
  assert.equal(desktop.actions.length, 0);
  if (first.status !== "approval") return;
  const second = await runComputerLoop({
    task: "Pay the invoice in the browser",
    desktop,
    model,
    maxSteps: 6,
    checkpoint: first.checkpoint,
    resume: { kind: "approval", decision: "reject" },
  });
  assert.equal(desktop.actions.length, 0);
  assert.equal(second.status, "done");
});

test("an approved desktop send runs once", async () => {
  const desktop = fakeDesktop();
  const model = scripted([
    [{ type: "text", text: "Submitting the form." }, tool("computer", { action: "key", text: "Return" }, "go")],
    [{ type: "text", text: "Submitted." }],
  ]);
  const first = await runComputerLoop({ task: "Submit the form", desktop, model });
  assert.equal(first.status, "approval");
  if (first.status !== "approval") return;
  const second = await runComputerLoop({
    task: "Submit the form",
    desktop,
    model,
    checkpoint: first.checkpoint,
    resume: { kind: "approval", decision: "approve" },
  });
  assert.equal(desktop.actions.length, 1);
  assert.equal(desktop.actions[0]?.kind, "key");
  assert.equal(second.status, "done");
});

test("a desktop action error is returned to the helper so it can try another action", async () => {
  const desktop = fakeDesktop();
  desktop.perform = async (action) => {
    desktop.actions.push(action);
    if (desktop.actions.length === 1) throw new Error("click missed the button");
  };
  const model = scripted([
    [tool("computer", { action: "left_click", coordinate: [1, 1] }, "bad")],
    [tool("computer", { action: "left_click", coordinate: [8, 8] }, "good")],
    [{ type: "text", text: "The second click worked." }],
  ]);
  const result = await runComputerLoop({ task: "Click the notes icon", desktop, model });
  assert.equal(result.status, "done");
  assert.equal(desktop.actions.length, 2);
  if (result.status === "done") assert.match(result.summary, /second click/);
});

test("the default computer step budget is the shared cap, and the stop returns an image", async () => {
  let calls = 0;
  const desktop = fakeDesktop();
  const model: ComputerModel = {
    async complete() {
      calls += 1;
      return { content: [tool("computer", { action: "left_click", coordinate: [1, 1] }, `c${calls}`)] };
    },
  };
  const result = await runComputerLoop({ task: "Open the browser, scroll, and open the top story", desktop, model });
  assert.equal(calls, COMPUTER_STEP_BUDGET);
  assert.equal(desktop.actions.length, COMPUTER_STEP_BUDGET);
  assert.equal(result.status, "done");
  if (result.status !== "done") return;
  assert.match(result.summary, /computer step budget/);
  assert.equal(result.screenshot, "aW1hZ2U=");
  const toolResult = computerToolResult("use-1", result);
  assert.equal(toolResult.is_error, undefined);
  assert.ok(Array.isArray(toolResult.content));
  const text = toolResult.content.find((part) => part.type === "text");
  const image = toolResult.content.find((part) => part.type === "image");
  assert.equal(text?.type, "text");
  assert.match(text && text.type === "text" ? text.text : "", /computer step budget/);
  assert.equal(image?.type, "image");
  if (image?.type === "image") {
    assert.equal(image.source.type, "base64");
    assert.equal(image.source.media_type, "image/png");
    assert.equal(image.source.data, "aW1hZ2U=");
  }
});

test("a stopped computer call reports the window and keeps the screenshot on an error", async () => {
  const desktop = fakeDesktop();
  desktop.observe = async () => ({ title: "Hacker News — Mozilla Firefox", url: "https://news.ycombinator.com/" });
  const model: ComputerModel = {
    async complete() {
      throw new Error("The computer model stopped.");
    },
  };
  const result = await runComputerLoop({ task: "Open the top story", desktop, model, maxSteps: 4 });
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.title, "Hacker News — Mozilla Firefox");
  assert.equal(result.url, "https://news.ycombinator.com/");
  const toolResult = computerToolResult("err-1", result);
  assert.equal(toolResult.is_error, true);
  assert.ok(Array.isArray(toolResult.content));
  const text = toolResult.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  assert.match(text, /Stopped because of an error: The computer model stopped\./);
  assert.match(text, /Window: Hacker News — Mozilla Firefox/);
  assert.match(text, /URL: https:\/\/news\.ycombinator\.com\//);
  assert.equal(toolResult.content.some((part) => part.type === "image" && part.source.data === "aW1hZ2U="), true);
});

test("a desktop run yields before the step budget and the next slice can finish", async () => {
  let now = 0;
  let calls = 0;
  const desktop = fakeDesktop();
  const model: ComputerModel = {
    async complete() {
      calls += 1;
      now += 20_000;
      if (calls > 4) return { content: [{ type: "text", text: "Hacker News is open." }] };
      return { content: [tool("computer", { action: "left_click", coordinate: [4, 4] }, `c${calls}`)] };
    },
  };
  const first = await runComputerLoop({ task: "Open Hacker News", desktop, model, sliceMs: 25_000, now: () => now });
  assert.equal(first.status, "continue");
  if (first.status !== "continue") return;
  assert.ok(first.checkpoint.stepsUsed > 0);
  assert.ok(first.checkpoint.stepsUsed < COMPUTER_STEP_BUDGET);
  assert.equal(first.streamUrl, desktop.streamUrl);
  const second = await runComputerLoop({
    task: "Open Hacker News",
    desktop,
    model,
    sliceMs: 1_000_000,
    now: () => now,
    checkpoint: first.checkpoint,
  });
  assert.equal(second.status, "done");
  if (second.status === "done") assert.match(second.summary, /Hacker News is open/);
  assert.ok(calls > first.checkpoint.stepsUsed);
});

test("a hung desktop model returns an error instead of stalling", async () => {
  const result = await runComputerLoop({
    task: "Open Hacker News",
    desktop: fakeDesktop(),
    model: { complete: () => new Promise(() => undefined) },
    callTimeoutMs: 30,
  });
  assert.equal(result.status, "error");
  if (result.status === "error") assert.match(result.message, /timed out/);
});

test("a hung window lookup still returns the desktop result", async () => {
  const desktop = fakeDesktop();
  desktop.observe = () => new Promise(() => undefined);
  const result = await runComputerLoop({
    task: "Open Hacker News",
    desktop,
    model: {
      async complete() {
        return { content: [{ type: "text", text: "The page is open." }] };
      },
    },
    callTimeoutMs: 40,
  });
  assert.equal(result.status, "done");
  if (result.status === "done") assert.match(result.summary, /page is open/);
});

test("a continued checkpoint keeps one screenshot, and an oversized one is not stored", async () => {
  const big = "B".repeat(40);
  let shots = 0;
  let now = 0;
  const desktop = fakeDesktop();
  desktop.screenshot = async () => {
    shots += 1;
    desktop.shots = shots;
    return `${big}${shots}`;
  };
  const model: ComputerModel = {
    async complete() {
      now += 10_000;
      return { content: [tool("computer", { action: "screenshot" }, `s${shots + 1}`)] };
    },
  };
  const result = await runComputerLoop({ task: "Look at the page", desktop, model, sliceMs: 55_000, now: () => now, maxSteps: 10 });
  assert.equal(result.status, "continue");
  if (result.status !== "continue") return;
  assert.ok(result.checkpoint.stepsUsed > 2);
  const copies = JSON.stringify(result.checkpoint).split(big).length - 1;
  assert.ok(copies >= 1 && copies <= 2, `checkpoint kept ${copies} screenshots`);
  const huge = "A".repeat(MAX_STORED_SCREENSHOT + 1);
  const dropped = computerToolResult("id", { status: "done", summary: "Opened the page.", screenshot: huge });
  assert.equal(typeof dropped.content, "string");
  assert.match(String(dropped.content), /too large to store/);
  assert.equal(String(dropped.content).includes(huge), false);
});

test("a desktop continue token is followed once", () => {
  assert.equal(nextComputerContinue(null, null, false), null);
  assert.equal(nextComputerContinue("slice-1", null, true), null);
  assert.equal(nextComputerContinue("slice-1", null, false), "slice-1");
  assert.equal(nextComputerContinue("slice-1", "slice-1", false), null);
  assert.equal(nextComputerContinue("slice-2", "slice-1", false), "slice-2");
});

test("a computer result without a screenshot is text only", () => {
  const done = computerToolResult("id", { status: "done", summary: "Desktop task finished." });
  assert.equal(done.is_error, undefined);
  assert.equal(done.content, "The desktop run finished. Desktop task finished.");
  const failed = computerToolResult("id", { status: "error", message: "Desktop failed" });
  assert.equal(failed.is_error, true);
  assert.equal(failed.content, "Stopped because of an error: Desktop failed");
});

test("a window title keeps a URL when the title contains one", () => {
  assert.deepEqual(observationFromWindowTitle("Hacker News — Mozilla Firefox"), { title: "Hacker News — Mozilla Firefox" });
  assert.deepEqual(observationFromWindowTitle("Open https://news.ycombinator.com/item?id=1."), {
    title: "Open https://news.ycombinator.com/item?id=1.",
    url: "https://news.ycombinator.com/item?id=1",
  });
  assert.deepEqual(observationFromWindowTitle("  "), {});
});

test("the desktop loop keeps only the latest screenshot for the next step", async () => {
  const seen: number[] = [];
  const model: ComputerModel = {
    async complete({ messages }) {
      seen.push(JSON.stringify(messages).split("aW1hZ2U=").length - 1);
      if (seen.length >= 3) return { content: [{ type: "text", text: "Done looking." }] };
      return { content: [tool("computer", { action: "screenshot" }, `s${seen.length}`)] };
    },
  };
  const result = await runComputerLoop({ task: "Look at the desktop", desktop: fakeDesktop(), model, maxSteps: 5 });
  assert.deepEqual(seen, [0, 1, 1]);
  assert.equal(result.status, "done");
});

test("a requested computer step count cannot exceed the shared cap", async () => {
  let calls = 0;
  const model: ComputerModel = {
    async complete() {
      calls += 1;
      return { content: [tool("computer", { action: "left_click", coordinate: [2, 2] }, `k${calls}`)] };
    },
  };
  const result = await runComputerLoop({ task: "Keep clicking", desktop: fakeDesktop(), model, maxSteps: 500 });
  assert.equal(calls, COMPUTER_STEP_BUDGET);
  assert.equal(result.status, "done");
});

test("a plain click is not an approval, and the tool version follows the model", () => {
  assert.equal(actionNeedsApproval({ kind: "left_click", coordinate: [1, 2] }, "Opening the homepage"), false);
  assert.equal(actionNeedsApproval({ kind: "key", text: "Return" }, "I will submit the payment"), true);
  assert.equal(computerToolForModel("claude-sonnet-4-5").betas[0], "computer-use-2025-01-24");
  assert.equal(computerToolForModel("claude-opus-4-1").betas[0], "computer-use-2025-01-24");
  assert.equal(computerToolForModel("claude-sonnet-4-6").betas[0], "computer-use-2025-11-24");
  assert.equal(computerToolForModel("claude-opus-4-8").betas[0], "computer-use-2025-11-24");
  assert.equal(computerToolForModel("claude-sonnet-5-5").tools[0]?.type, "computer_toolset_20260801");
  assert.equal(computerToolForModel("claude-opus-5-5").tools[0]?.type, "computer_toolset_20260801");
  assert.equal(computerToolForModel("claude-haiku-5-5").tools[0]?.type, "computer_toolset_20260801");
});

test("each user gets one sandbox, and an idle one is paused", async () => {
  const paused: string[] = [];
  const created: string[] = [];
  const factory: DesktopFactory = {
    async create(userId) {
      created.push(userId);
      return session(`sbx-${userId}`);
    },
    async connect(sandboxId) {
      return session(sandboxId);
    },
  };
  function session(sandboxId: string): DesktopSession {
    return {
      sandboxId,
      streamUrl: `https://stream.example/${sandboxId}`,
      async screenshot() {
        return "aW1hZ2U=";
      },
      async perform() {},
      async pause() {
        paused.push(sandboxId);
      },
    };
  }
  let now = 1_000;
  const manager = createDesktopManager({ store: memoryDesktopStore(), factory, now: () => now, idleMs: 50 });
  const first = await manager.open("user-a");
  const second = await manager.open("user-a");
  assert.deepEqual(created, ["user-a"]);
  assert.equal(first.sandboxId, second.sandboxId);
  now = 10_000;
  const count = await manager.pauseIdle();
  assert.equal(count, 1);
  assert.deepEqual(paused, ["sbx-user-a"]);
});

function goneSandbox(kind: "sdk" | "name" | "status" | "message"): Error {
  if (kind === "status") return Object.assign(new Error("request failed"), { statusCode: 404 });
  if (kind === "message") return new Error("Paused sandbox ixwwdcwvd7ww9nsmaxeeh not found");
  const err = new Error(kind === "sdk" ? "Paused sandbox ixwwdcwvd7ww9nsmaxeeh not found" : "missing");
  err.name = kind === "name" ? "NotFoundError" : "SandboxNotFoundError";
  return err;
}

test("a missing sandbox is recognized from E2B's not-found error, and other failures are not", () => {
  assert.equal(isMissingSandbox(goneSandbox("sdk")), true);
  assert.equal(isMissingSandbox(goneSandbox("name")), true);
  assert.equal(isMissingSandbox(goneSandbox("status")), true);
  assert.equal(isMissingSandbox(goneSandbox("message")), true);
  const file = new Error("file not found");
  file.name = "FileNotFoundError";
  assert.equal(isMissingSandbox(file), false);
  assert.equal(isMissingSandbox(new Error("E2B is unavailable")), false);
  assert.equal(isMissingSandbox(new Error("The desktop took too long to start.")), false);
});

test("a stored sandbox E2B no longer has is replaced in the same open, and the old stream is dropped", async () => {
  for (const kind of ["sdk", "name", "status", "message"] as const) {
    const store = memoryDesktopStore();
    await store.save({
      userId: "user-a",
      sandboxId: "ixwwdcwvd7ww9nsmaxeeh",
      streamUrl: "https://stream.example/old",
      lastUsedAt: 1,
      pausedAt: 1,
    });
    const created: string[] = [];
    const connected: string[] = [];
    const factory: DesktopFactory = {
      async create(userId) {
        created.push(userId);
        return openSession("sbx-new", "https://stream.example/new");
      },
      async connect(sandboxId) {
        connected.push(sandboxId);
        if (sandboxId === "ixwwdcwvd7ww9nsmaxeeh") throw goneSandbox(kind);
        return openSession(sandboxId, `https://stream.example/${sandboxId}`);
      },
    };
    const manager = createDesktopManager({ store, factory, now: () => 5_000, idleMs: 50 });
    const opened = await manager.open("user-a");
    assert.equal(opened.sandboxId, "sbx-new", kind);
    assert.equal(opened.streamUrl, "https://stream.example/new", kind);
    assert.deepEqual(created, ["user-a"], kind);
    assert.deepEqual(connected, ["ixwwdcwvd7ww9nsmaxeeh"], kind);
    const saved = await store.get("user-a");
    assert.equal(saved?.sandboxId, "sbx-new", kind);
    assert.equal(saved?.streamUrl, "https://stream.example/new", kind);
    assert.equal(saved?.pausedAt, null, kind);
    const again = await manager.open("user-a");
    assert.equal(again.sandboxId, "sbx-new", kind);
    assert.deepEqual(connected, ["ixwwdcwvd7ww9nsmaxeeh", "sbx-new"], kind);
  }
});

test("a connect failure that is not a missing sandbox stays an error", async () => {
  const store = memoryDesktopStore();
  const row: DesktopRecord = {
    userId: "user-a",
    sandboxId: "sbx-live",
    streamUrl: "https://stream.example/live",
    lastUsedAt: 1,
    pausedAt: null,
  };
  await store.save(row);
  let created = 0;
  const factory: DesktopFactory = {
    async create() {
      created += 1;
      return openSession("sbx-new", "https://stream.example/new");
    },
    async connect() {
      throw new Error("E2B is unavailable");
    },
  };
  const manager = createDesktopManager({ store, factory, now: () => 5_000, idleMs: 50_000 });
  await assert.rejects(manager.open("user-a"), /E2B is unavailable/);
  assert.equal(created, 0);
  assert.equal((await store.get("user-a"))?.sandboxId, "sbx-live");
  assert.equal((await store.get("user-a"))?.streamUrl, "https://stream.example/live");
});

test("pausing a sandbox that is gone drops the stored id, and a live one is paused without connecting", async () => {
  const store = memoryDesktopStore();
  await store.save({ userId: "gone", sandboxId: "ixwwdcwvd7ww9nsmaxeeh", streamUrl: "https://stream.example/old", lastUsedAt: 1, pausedAt: null });
  await store.save({ userId: "idle", sandboxId: "sbx-idle", streamUrl: "https://stream.example/idle", lastUsedAt: 1, pausedAt: null });
  const connected: string[] = [];
  const paused: string[] = [];
  const factory: DesktopFactory = {
    async create() {
      return openSession("sbx-new", "https://stream.example/new");
    },
    async connect(sandboxId) {
      connected.push(sandboxId);
      return openSession(sandboxId, `https://stream.example/${sandboxId}`);
    },
    async pause(sandboxId) {
      if (sandboxId === "ixwwdcwvd7ww9nsmaxeeh") throw goneSandbox("sdk");
      paused.push(sandboxId);
    },
  };
  const manager = createDesktopManager({ store, factory, now: () => 10_000, idleMs: 50 });
  const count = await manager.pauseIdle();
  assert.equal(count, 1);
  assert.deepEqual(paused, ["sbx-idle"]);
  assert.deepEqual(connected, []);
  assert.equal(await store.get("gone"), null);
  assert.equal((await store.get("idle"))?.pausedAt, 10_000);
  assert.equal((await manager.stream("gone"))?.streamUrl, undefined);
  assert.equal((await manager.stream("idle"))?.streamUrl, "https://stream.example/idle");
});

test("a new desktop never keeps the previous stream url", () => {
  assert.deepEqual(adoptDesktop({ streamUrl: "https://stream.example/old", sandboxId: "ixwwdcwvd7ww9nsmaxeeh" }, { streamUrl: "https://stream.example/new", sandboxId: "sbx-new" }), {
    streamUrl: "https://stream.example/new",
    sandboxId: "sbx-new",
  });
  assert.deepEqual(adoptDesktop({ streamUrl: "https://stream.example/old", sandboxId: "ixwwdcwvd7ww9nsmaxeeh" }, { streamUrl: "", sandboxId: "sbx-new" }), {
    streamUrl: "",
    sandboxId: "sbx-new",
  });
  assert.deepEqual(adoptDesktop({ streamUrl: "https://stream.example/live", sandboxId: "sbx-live" }, { sandboxId: "sbx-live" }), {
    streamUrl: "https://stream.example/live",
    sandboxId: "sbx-live",
  });
});

test("the running timeout pauses instead of killing, and stays within E2B's one hour cap", () => {
  assert.equal(desktopTimeoutMs({}), desktopIdleMs({}));
  assert.equal(desktopTimeoutMs({ E2B_IDLE_MS: "600000" }), 600_000);
  assert.equal(desktopTimeoutMs({ E2B_TIMEOUT_MS: "600000" }), 600_000);
  assert.equal(desktopTimeoutMs({ E2B_TIMEOUT_MS: "1000" }), desktopIdleMs({}));
  assert.equal(desktopTimeoutMs({ E2B_TIMEOUT_MS: String(24 * 60 * 60 * 1000) }), E2B_MAX_RUNNING_MS);
  assert.equal(desktopTimeoutMs({ E2B_IDLE_MS: String(2 * 60 * 60 * 1000) }), E2B_MAX_RUNNING_MS);
  assert.deepEqual(desktopSandboxConfig({}), { timeoutMs: desktopIdleMs({}), lifecycle: { onTimeout: "pause" } });
  assert.ok(desktopSandboxConfig({}).timeoutMs <= E2B_MAX_RUNNING_MS);
});

test("a checkpoint for a sandbox that is gone starts the desktop task over", async () => {
  const stale = {
    task: "Open Hacker News",
    sandboxId: "ixwwdcwvd7ww9nsmaxeeh",
    messages: [
      { role: "user" as const, content: "old screen" },
      { role: "assistant" as const, content: "clicked the old button" },
    ],
    stepsUsed: 12,
  };
  assert.equal(resumeComputerCheckpoint(stale, { sandboxId: "sbx-new" }), undefined);
  assert.equal(resumeComputerCheckpoint(stale, { sandboxId: "ixwwdcwvd7ww9nsmaxeeh", replaced: true }), undefined);
  assert.equal(resumeComputerCheckpoint({ task: "Open Hacker News", messages: [], stepsUsed: 2 }, { sandboxId: "sbx-new", replaced: true }), undefined);
  assert.equal(resumeComputerCheckpoint(stale, { sandboxId: "ixwwdcwvd7ww9nsmaxeeh" })?.stepsUsed, 12);
  let firstUser = "";
  const result = await runComputerLoop({
    task: "Open Hacker News",
    desktop: fakeDesktop(),
    model: {
      async complete({ messages }) {
        const first = messages[0];
        firstUser = typeof first?.content === "string" ? first.content : "";
        return { content: [{ type: "text", text: "Started on a new desktop." }] };
      },
    },
    checkpoint: stale,
  });
  assert.equal(firstUser, "Open Hacker News");
  assert.equal(result.status, "done");
  if (result.status === "done") assert.match(result.summary, /new desktop/);
});

function openSession(sandboxId: string, streamUrl: string): DesktopSession {
  return {
    sandboxId,
    streamUrl,
    async screenshot() {
      return "aW1hZ2U=";
    },
    async perform() {},
    async pause() {},
  };
}
