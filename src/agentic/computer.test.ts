import assert from "node:assert/strict";
import test from "node:test";
import { actionNeedsApproval, computerToolForModel, runComputerLoop, type ComputerModel, type DesktopHandle, type NormalizedAction } from "./computer";
import { createDesktopManager, memoryDesktopStore, type DesktopFactory, type DesktopSession } from "./desktop";
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
  if (result.status === "done") assert.match(result.summary, /Typed rent/);
  assert.equal(desktop.shots, 2);
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

test("a plain click is not an approval, and the tool version follows the model", () => {
  assert.equal(actionNeedsApproval({ kind: "left_click", coordinate: [1, 2] }, "Opening the homepage"), false);
  assert.equal(actionNeedsApproval({ kind: "key", text: "Return" }, "I will submit the payment"), true);
  assert.equal(computerToolForModel("claude-sonnet-4-5").betas[0], "computer-use-2025-01-24");
  assert.equal(computerToolForModel("claude-sonnet-4-6").betas[0], "computer-use-2025-11-24");
  assert.equal(computerToolForModel("claude-sonnet-5-5").tools[0]?.type, "computer_toolset_20260801");
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
