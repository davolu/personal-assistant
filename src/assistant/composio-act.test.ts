import assert from "node:assert/strict";
import { test } from "node:test";
import { createBuiltinProvider } from "./builtin";
import { MemoryStore } from "./memory-store";
import { ToolHub } from "./hub";
import { runTurn } from "./orchestrator";
import { baseTurn, json, recordingProvider, ScriptedModel } from "./test-support";
import type { ToolSpec } from "./types";

const gmailSend: ToolSpec = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email from the connected Gmail account",
  inputSchema: {},
  effect: "external",
  provider: "composio",
};

const NOW = () => new Date("2026-11-11T12:00:00.000Z");

test("sending from the connected Gmail account is held and the prompt has the owner's address", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([gmailSend]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ intent: "act", success: "prepare the email", steps: [{ id: "s1", goal: "send the email", toolQuery: "send email" }] });
    }
    assert.match(req.system, /owner@example.com/);
    assert.match(req.system, /GMAIL_SEND_EMAIL/);
    return json({
      done: false,
      reply: "",
      calls: [{ tool: "GMAIL_SEND_EMAIL", args: { recipient_email: "owner@example.com", body: "Hello" } }],
    });
  });
  const result = await runTurn(
    baseTurn({
      text: "send a hello mail to my gmail",
      ownerEmail: "owner@example.com",
      catalog: ["Gmail", "Zoho Mail"],
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.deepEqual(apps.calls, []);
  assert.equal(result.approval?.tool, "GMAIL_SEND_EMAIL");
  assert.equal((result.approval?.args as { recipient_email?: string }).recipient_email, "owner@example.com");
  assert.match(result.reply, /I'll send this email to owner@example.com/);
  assert.doesNotMatch(result.reply, /GMAIL_SEND_EMAIL/);
});

test("an unconnected Zoho request returns connect links instead of a refusal", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([
    createBuiltinProvider(store, NOW, {
      async connectApp(_userId, app) {
        return { url: `https://connect.example/${encodeURIComponent(app)}`, app };
      },
    }),
  ], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") return json({ intent: "chat", success: "answer", steps: [] });
    return json({ done: true, reply: "I cannot access Zoho because it is not connected.", calls: [] });
  });
  const offered: string[] = [];
  const result = await runTurn(
    baseTurn({
      text: "I want a summary of my zoho to my gmail",
      ownerEmail: "owner@example.com",
      catalog: ["Gmail", "Zoho Mail", "Zoho CRM", "Zoho Books"],
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    {
      model,
      hub,
      store,
      now: NOW,
      connectApp: async (_userId, app) => {
        offered.push(app);
        return { url: `https://connect.example/${encodeURIComponent(app)}`, app };
      },
    }
  );
  assert.match(result.reply, /https:\/\/connect\.example\//);
  assert.equal(/cannot access Zoho/i.test(result.reply), false);
  assert.ok(offered.includes("Zoho Mail"));
  assert.equal(offered.includes("Gmail"), false);
});
