import assert from "node:assert/strict";
import { test } from "node:test";
import { helpfulFallback } from "./apps";
import { parsePlan } from "./planner";
import { MemoryStore } from "./memory-store";
import { ToolHub } from "./hub";
import { createBuiltinProvider } from "./builtin";
import { runTurn } from "./orchestrator";
import { baseTurn, ScriptedModel } from "./test-support";

const BRIEF =
  "a video agent that can create videos, characters and image from script given it and it will be 3-5 minutes in length and can also edit videos with prompts";

test("prose around a plan is still accepted", () => {
  const parsed = parsePlan('Sure.\n{"intent":"chat","success":"answer the question","steps":[]}');
  assert.equal(parsed.ok, true);
});

test("plain prose is not a plan", () => {
  const parsed = parsePlan("I can help you design that video agent.");
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error, "plan_not_json");
});

test("a rejected plan falls back to a builder link and video connect links", async () => {
  const store = new MemoryStore();
  const now = () => new Date("2026-11-11T12:00:00.000Z");
  const hub = new ToolHub([createBuiltinProvider(store, now)], 1000);
  const model = new ScriptedModel(() => "I can help you design that video agent.");
  const result = await runTurn(
    baseTurn({
      text: BRIEF,
      catalog: ["Gmail", "Runway", "HeyGen", "Descript"],
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    {
      model,
      hub,
      store,
      now,
      connectApp: async (_userId, app) => ({ url: `https://connect.example/${app}`, app }),
    }
  );
  assert.equal(result.stopReason, "MODEL_ANSWER");
  assert.equal(result.reply.includes("usable plan"), false);
  assert.match(result.reply, /\/create\?idea=/);
  assert.match(result.reply, /https:\/\/connect\.example\/Runway/);
  assert.match(helpfulFallback(BRIEF), /\/create\?idea=/);
});
