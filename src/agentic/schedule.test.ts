import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCadence } from "./cadence";
import { runDueSchedules } from "./schedule-due";
import { createMemoryScheduleStore } from "./schedule-store";
import { scheduleFromToolArgs } from "./schedules";

test("a schedule belongs to one user and a due slot runs once", async () => {
  const store = createMemoryScheduleStore();
  const cadence = normalizeCadence({ kind: "daily", time: "09:00", timezone: "UTC" });
  assert.equal(cadence.ok, true);
  if (!cadence.ok) return;
  const saved = await store.create({
    userId: "ada",
    threadId: "thread-1",
    draft: { name: "Recap", goal: "Draft the recap", cadence: cadence.cadence, notify: true, allowRisky: false },
    context: "User: Draft the recap",
  });
  assert.equal(await store.get("lee", saved.id), null);
  assert.equal((await store.list("lee")).length, 0);

  const now = new Date(saved.nextRunAt ?? Date.now());
  let runs = 0;
  const first = await runDueSchedules(store, now, async () => {
    runs += 1;
    return { status: "success", summary: "Drafted it." };
  });
  const second = await runDueSchedules(store, now, async () => {
    runs += 1;
    return { status: "success", summary: "again" };
  });
  assert.equal(first.claimed, 1);
  assert.equal(second.claimed, 0);
  assert.equal(runs, 1);
  const owner = await store.get("ada", saved.id);
  assert.equal(owner?.lastStatus, "success");
  const history = await store.listRuns("ada", 10);
  assert.equal(history.length, 1);
  assert.equal((await store.listRunsForThread("lee", "thread-1", 10)).length, 0);
});

test("schedule_task describes a generic cadence and refuses a risky flag that is not explicit", () => {
  const parsed = scheduleFromToolArgs({ goal: "Check the inbox", cadence: "daily", time: "09:00", timezone: "UTC", allow_risky: "yes" }, "");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.draft.allowRisky, false);
  assert.match(parsed.summary, /Daily at 9:00 AM/);
  assert.match(parsed.summary, /still wait for approval/);
  assert.equal(parsed.summary.includes("gmail"), false);
});

test("schedule tables are created with idempotent SQL", () => {
  const sql = readFileSync(new URL("../../prisma/sql/agentic.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agentic_schedule/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agentic_schedule_run/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS agentic_schedule_run_once/);
  const nav = readFileSync(new URL("../components/Nav.tsx", import.meta.url), "utf8");
  const side = readFileSync(new URL("../components/AppSidebar.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../components/MobileTabs.tsx", import.meta.url), "utf8");
  for (const source of [nav, side, mobile]) {
    assert.match(source, /\/agentic-chat"/);
    assert.match(source, /Chat/);
    assert.match(source, /\/schedule"/);
    assert.match(source, /Schedule/);
  }
  const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /Autonomous agents/);
  assert.match(dashboard, /Scheduled agents/);
  assert.match(dashboard, /Recent runs/);
  assert.match(dashboard, /Pending approvals/);
  assert.doesNotMatch(dashboard, /template/i);
  assert.doesNotMatch(dashboard, /Add from templates/);
});
