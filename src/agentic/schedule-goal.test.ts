import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCadence } from "./cadence";
import { distillScheduleGoal, firstUserMessage, goalNeedsRepair, repairScheduleRows, transcriptForGoal, validScheduleGoal, visibleRunOutput } from "./schedule-goal";
import { createMemoryScheduleStore } from "./schedule-store";
import { parseScheduleRequest, scheduleFromToolArgs, scheduleSeed } from "./schedules";

const INSTRUCTION = "Each run, collect the latest items and send the summary to the destination already chosen.";

test("hours and other cadence numbers cannot become the schedule goal", () => {
  const payload = {
    threadId: "thread-1",
    name: "Morning brief",
    goal: INSTRUCTION,
    kind: "interval" as const,
    time: "09:00",
    weekday: 1,
    hours: 1,
    cron: "0 9 * * 1",
    timezone: "Africa/Lagos",
    notify: true,
    allowRisky: true,
  };
  const saved = parseScheduleRequest(payload);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.draft.goal, INSTRUCTION);
  assert.equal(saved.draft.cadence.hours, 1);
  assert.equal(saved.draft.cadence.timezone, "Africa/Lagos");
  assert.notEqual(saved.draft.goal, String(payload.hours));
  assert.notEqual(saved.draft.goal, String(payload.weekday));

  const numericString = parseScheduleRequest({ ...payload, goal: "1" });
  assert.equal(numericString.ok, false);

  const numericField = scheduleFromToolArgs({ goal: 1, hours: 1, kind: "interval", timezone: "UTC" }, "1");
  assert.equal(numericField.ok, false);

  const missingGoal = scheduleFromToolArgs({ hours: 1, weekday: 1, kind: "interval", timezone: "UTC" }, "");
  assert.equal(missingGoal.ok, false);

  const fallback = scheduleFromToolArgs({ goal: "1", hours: 1, cadence: "interval", timezone: "UTC" }, INSTRUCTION);
  assert.equal(fallback.ok, true);
  if (!fallback.ok) return;
  assert.equal(fallback.draft.goal, INSTRUCTION);
  assert.equal(fallback.draft.cadence.hours, 1);
  assert.equal(validScheduleGoal(1), "");
  assert.equal(validScheduleGoal("  2 "), "");
  assert.equal(goalNeedsRepair("1"), true);
  assert.equal(goalNeedsRepair(""), true);
  assert.equal(goalNeedsRepair(INSTRUCTION), false);
});

test("a scheduled run starts from the saved instruction and can send when that was allowed", () => {
  const seed = scheduleSeed({
    goal: INSTRUCTION,
    context: "User: Send it to the destination we picked.\nAssistant: The destination is saved.",
    allowRisky: true,
  });
  assert.match(seed, /Each run, collect the latest items/);
  assert.match(seed, /destination we picked/);
  assert.match(seed, /Do not stop to ask for approval/);
  assert.equal(seed.includes("\n1\n"), false);
  const held = scheduleSeed({ goal: INSTRUCTION, context: "", allowRisky: false });
  assert.match(held, /still wait for the user's approval/);
});

test("the model writes the standing instruction, and a failed call uses the first user message", async () => {
  const messages = [
    { role: "user", content: "Get the latest items and send a summary to the destination I picked." },
    { role: "assistant", content: "I sent the summary to the destination you picked." },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "destination confirmed" }] },
  ];
  const transcript = transcriptForGoal(messages);
  assert.match(transcript, /destination I picked/);
  assert.match(transcript, /destination confirmed/);
  assert.equal(firstUserMessage(messages), "Get the latest items and send a summary to the destination I picked.");

  let seen = "";
  const distilled = await distillScheduleGoal(messages, async (text) => {
    seen = text;
    return "Each run, get the latest items and send the summary to the destination already picked.";
  });
  assert.match(seen, /destination confirmed/);
  assert.equal(distilled, "Each run, get the latest items and send the summary to the destination already picked.");

  const failed = await distillScheduleGoal(messages, async () => {
    throw new Error("model down");
  });
  assert.equal(failed, firstUserMessage(messages));

  const numeric = await distillScheduleGoal(messages, async () => "1");
  assert.equal(numeric, firstUserMessage(messages));
  assert.notEqual(numeric, "1");
});

test("broken schedule goals are backfilled once and a real goal is left alone", async () => {
  const store = createMemoryScheduleStore();
  const cadence = normalizeCadence({ kind: "interval", hours: 1, timezone: "UTC" });
  assert.equal(cadence.ok, true);
  if (!cadence.ok) return;
  const broken = await store.create({
    userId: "ada",
    threadId: "thread-1",
    draft: { name: "Morning brief", goal: "1", cadence: cadence.cadence, notify: true, allowRisky: true },
    context: "",
  });
  const empty = await store.create({
    userId: "ada",
    threadId: "thread-2",
    draft: { name: "Empty", goal: "   ", cadence: cadence.cadence, notify: true, allowRisky: false },
    context: "",
  });
  const healthy = await store.create({
    userId: "ada",
    threadId: "thread-3",
    draft: { name: "Healthy", goal: INSTRUCTION, cadence: cadence.cadence, notify: true, allowRisky: false },
    context: "User: keep this",
  });
  const calls: string[] = [];
  const fixed = await repairScheduleRows(
    store,
    "ada",
    async (_userId, threadId) => [
      {
        role: "user",
        content: threadId === "thread-2" ? "Repeat the saved checklist." : "Get the latest items and send a summary to the destination I picked.",
      },
      { role: "assistant", content: "The destination is already chosen." },
    ],
    async (_userId, threadId) => {
      calls.push(threadId);
      if (threadId === "thread-2") throw new Error("model down");
      return "Each run, get the latest items and send the summary to the destination already picked.";
    }
  );
  assert.equal(fixed, 2);
  assert.deepEqual(calls.sort(), ["thread-1", "thread-2"]);
  const repaired = await store.get("ada", broken.id);
  assert.equal(repaired?.goal, "Each run, get the latest items and send the summary to the destination already picked.");
  assert.equal(repaired?.cadence.hours, 1);
  const fromFallback = await store.get("ada", empty.id);
  assert.equal(fromFallback?.goal, "Repeat the saved checklist.");
  assert.equal(fromFallback?.cadence.hours, 1);
  const kept = await store.get("ada", healthy.id);
  assert.equal(kept?.goal, INSTRUCTION);

  const again = await repairScheduleRows(
    store,
    "ada",
    async () => {
      throw new Error("should not load a healthy schedule");
    },
    async () => {
      throw new Error("should not distill a healthy schedule");
    }
  );
  assert.equal(again, 0);
  assert.equal((await store.get("ada", broken.id))?.goal, repaired?.goal);
  assert.equal((await store.get("ada", empty.id))?.goal, "Repeat the saved checklist.");
  assert.equal((await store.get("ada", healthy.id))?.goal, INSTRUCTION);
});

test("the last run result is shown once", () => {
  const done = visibleRunOutput("The run wrote this.", { status: "success", summary: "The run wrote this." });
  assert.equal(done.output, "The run wrote this.");
  assert.equal(done.pending, "");
  const starting = visibleRunOutput("Older result", { status: "running", summary: "Starting…" });
  assert.equal(starting.output, "Older result");
  assert.equal(starting.pending, "Starting…");
  assert.notEqual(starting.output, starting.pending);
});

test("the schedule form keeps the instruction separate from the hours field", () => {
  const client = readFileSync(new URL("../app/agentic-chat/AgenticChatClient.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../components/SchedulePicker.tsx", import.meta.url), "utf8");
  const store = readFileSync(new URL("./schedule-store.ts", import.meta.url), "utf8");
  assert.match(picker, /What should it do each run\?/);
  assert.match(client, /goal: draft\.goal/);
  assert.doesNotMatch(client, /goal:\s*lastUserText/);
  assert.match(store, /\^\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$/);
  const page = readFileSync(new URL("../app/schedule/ScheduleClient.tsx", import.meta.url), "utf8");
  assert.match(page, /visibleRunOutput/);
  assert.match(page, /<ScheduleResult/);
});
