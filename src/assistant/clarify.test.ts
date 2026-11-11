import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRequest, isBrief, SAMPLE_VIDEO_BRIEF } from "./intent";
import { createBuiltinProvider } from "./builtin";
import { MemoryStore } from "./memory-store";
import { ToolHub } from "./hub";
import { runTurn } from "./orchestrator";
import { baseTurn, json, recordingProvider, ScriptedModel } from "./test-support";
import type { ToolSpec } from "./types";
import { clampText } from "./util";

const NOW = () => new Date("2026-11-11T12:00:00.000Z");

const search: ToolSpec = {
  name: "COMPOSIO_SEARCH_WEB",
  description: "Search the public web",
  inputSchema: {},
  effect: "read",
  provider: "composio",
};

const gmailSend: ToolSpec = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email",
  inputSchema: {},
  effect: "external",
  provider: "composio",
};

test("a pasted brief is not a clear action, and a send is", () => {
  assert.equal(isBrief(SAMPLE_VIDEO_BRIEF), true);
  assert.equal(classifyRequest(SAMPLE_VIDEO_BRIEF), "brief");
  assert.equal(classifyRequest("send this email to my gmail saying hello"), "clear_action");
  assert.equal(classifyRequest("help me figure something out"), "needs_clarification");
  assert.equal(classifyRequest("hello"), "clear_action");
});

test("a vague video-agent brief asks questions and does not call tools", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const seen: string[] = [];
  const model = new ScriptedModel((req) => {
    seen.push(req.role);
    if (req.system.includes("Do not call tools")) {
      return json({
        understanding: "You want a video agent that creates and edits short videos from a script.",
        questions: ["Will you paste the script?"],
        steps: ["Confirm the first video", "Choose where the files live"],
      });
    }
    return json({ done: false, reply: "", calls: [{ tool: "builtin.web.search", args: { query: "video agent" } }] });
  });
  const events: string[] = [];
  const result = await runTurn(
    baseTurn({
      text: SAMPLE_VIDEO_BRIEF,
      catalog: ["Gmail", "Runway", "HeyGen", "Descript"],
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    {
      model,
      hub,
      store,
      now: NOW,
      onEvent: (event) => events.push(event.type === "think" ? event.text : event.type),
    }
  );
  assert.deepEqual(apps.calls, []);
  assert.equal(result.trace.length, 0);
  assert.deepEqual(seen, ["plan"]);
  assert.match(result.reply, /Before I use any tools/);
  assert.match(result.reply, /Proposed plan:/);
  assert.match(result.reply, /Will you paste the script/);
  assert.equal(result.proposal?.questions[0], "Will you paste the script?");
  assert.ok(events.some((event) => /brief/i.test(event)));
  assert.equal(events.some((event) => /COMPOSIO_|builtin\./.test(event)), false);
});

test("a clear email request still takes the action path", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([gmailSend]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ intent: "act", success: "prepare the email", steps: [{ id: "s1", goal: "send the email", toolQuery: "send email gmail" }] });
    }
    return json({ done: true, reply: "Ready.", calls: [{ tool: "GMAIL_SEND_EMAIL", args: { body: "Hello" } }] });
  });
  const result = await runTurn(
    baseTurn({
      text: "send this email to my gmail saying hello",
      ownerEmail: "owner@example.com",
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.equal(result.approval?.tool, "GMAIL_SEND_EMAIL");
  assert.equal(result.proposal, null);
  assert.doesNotMatch(result.reply, /Before I use any tools/);
  assert.equal(apps.calls.length, 0);
});

test("tool results are clipped before they can flood the next model call", () => {
  const clipped = clampText("x".repeat(2000), 1200);
  assert.equal(clipped.truncated, true);
  assert.ok(clipped.text.length < 1300);
  assert.match(clipped.text, /truncated/);
});
