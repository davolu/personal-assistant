import assert from "node:assert/strict";
import { test } from "node:test";
import { describeApproval } from "./approval-copy";
import { createBuiltinProvider } from "./builtin";
import { MemoryStore } from "./memory-store";
import { ToolHub } from "./hub";
import { runTurn } from "./orchestrator";
import { gateDecision } from "./policy";
import { baseTurn, json, recordingProvider, ScriptedModel } from "./test-support";
import type { ToolSpec } from "./types";

const search: ToolSpec = {
  name: "COMPOSIO_SEARCH_WEB",
  description: "Search the public web",
  inputSchema: {},
  effect: "read",
  provider: "composio",
};

const NOW = () => new Date("2026-11-11T12:00:00.000Z");

test("routine approval text comes from the routine, not the latest chat line", () => {
  const reply = describeApproval(
    "builtin.routines.create",
    { cadence: "daily", prompt: "Search for latest grants and send to my email", name: "Daily grants" },
    { text: "Looks good, go", ownerEmail: "owner@example.com" }
  );
  assert.match(reply, /I'll search for latest grants every day and email them to you at owner@example.com/);
  assert.doesNotMatch(reply, /looks good, go/i);
});

test("a daily routine approval is a sentence the owner can read", () => {
  const reply = describeApproval(
    "builtin.routines.create",
    { cadence: "daily", prompt: "Search for latest grants and send to my email" },
    { text: "Search for latest grants and send to my email once a day", ownerEmail: "owner@example.com" }
  );
  assert.match(reply, /I'll search for latest grants every day and email them to you at owner@example.com/);
  assert.match(reply, /Approve to set up this daily routine/);
  assert.doesNotMatch(reply, /builtin\.|GMAIL_|COMPOSIO_/);
});

test("a daily grant email is held once as a routine and does not recommend Zapier", async () => {
  assert.equal(gateDecision("builtin.routines.create").decision, "hold");
  const store = new MemoryStore();
  const created: string[] = [];
  const apps = recordingProvider([search]);
  const hub = new ToolHub([
    createBuiltinProvider(store, NOW, {
      webSearch: async () => ({ results: ["nonprofit grants"] }),
      routines: {
        async create(_userId, input) {
          created.push(input.prompt);
          return { id: "r1", name: input.name, cadence: input.cadence, prompt: input.prompt, enabled: true };
        },
        async list() {
          return [];
        },
        async delete() {
          return true;
        },
      },
    }),
    apps.provider,
  ], 1000);
  let act = 0;
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ intent: "act", success: "schedule the digest", steps: [{ id: "s1", goal: "search the web for grants and create a daily routine", toolQuery: "web search grants email schedule routine" }] });
    }
    act += 1;
    if (act === 1) return json({ done: true, reply: "I don't have a tool to search the web. Use Zapier.", calls: [] });
    if (!req.system.includes("builtin.web.search")) return json({ done: true, reply: "still missing", calls: [] });
    return json({
      done: false,
      reply: "",
      calls: [
        { tool: "builtin.web.search", args: { query: "latest nonprofit grants" } },
        { tool: "builtin.routines.create", args: { cadence: "daily", prompt: "Search grants and email the owner", name: "Daily grants" } },
      ],
    });
  });
  const result = await runTurn(
    baseTurn({
      text: "Search for latest grants and send to my email once a day",
      ownerEmail: "owner@example.com",
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.equal(result.approval?.tool, "builtin.routines.create");
  assert.equal(created.length, 0);
  assert.equal(/zapier/i.test(result.reply), false);
  assert.match(result.reply, /Approve to set up this daily routine/);
  assert.match(result.reply, /owner@example.com/);
  assert.doesNotMatch(result.reply, /builtin\.routines/);
  assert.ok(result.trace.some((entry) => entry.tool === "builtin.web.search"));
});

test("a built-in routine proposal is held for approval", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const model = new ScriptedModel(() =>
    json({
      action: "propose",
      understanding: "Search for latest grants and send to my email once a day",
      steps: [{ goal: "Create the daily routine", tool: "builtin.routines.create" }],
    })
  );
  const result = await runTurn(baseTurn({ text: "Search for latest grants and send to my email once a day", ownerEmail: "owner@example.com" }), {
    model,
    hub,
    store,
    now: NOW,
  });
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.equal(result.approval?.tool, "builtin.routines.create");
  assert.doesNotMatch(result.reply, /couldn't match/i);
});

test("an approved routine may send without asking again", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([
    {
      name: "GMAIL_SEND_EMAIL",
      description: "Send an email",
      inputSchema: {},
      effect: "external",
      provider: "composio",
    },
  ]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ intent: "act", success: "send the digest", steps: [{ id: "s1", goal: "send the grant email", toolQuery: "send email gmail" }] });
    }
    return json({ done: true, reply: "Sent the digest.", calls: [{ tool: "GMAIL_SEND_EMAIL", args: { body: "Grants" } }] });
  });
  const result = await runTurn(baseTurn({ text: "send today's grants", preapprovedExternal: true, connections: [{ toolkit: "Gmail", status: "active", scopes: "" }] }), {
    model,
    hub,
    store,
    now: NOW,
  });
  assert.equal(result.stopReason, "MODEL_ANSWER");
  assert.deepEqual(apps.calls.map((call) => call.name), ["GMAIL_SEND_EMAIL"]);
});
