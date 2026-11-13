import assert from "node:assert/strict";
import test from "node:test";
import { budgetIntentFromModel, knownBudgetIntent, pauseActiveClock, settleActiveClock } from "./budgets";

test("parked time is not added when the run resumes", () => {
  const paused = pauseActiveClock({ startedAt: 1_000, activeMs: 0 }, 4_000);
  assert.deepEqual(paused, { startedAt: 0, activeMs: 3_000 });
  const resumed = settleActiveClock({ ...paused, touchedAt: 4_000 }, 4_000 + 30 * 60 * 1000);
  assert.equal(resumed.activeMs, 3_000);
  assert.equal(resumed.startedAt, 4_000 + 30 * 60 * 1000);
});

test("a gap after the last step is parked, and a short gap is still active", () => {
  const afterWait = settleActiveClock({ startedAt: 1_000, activeMs: 500, touchedAt: 5_000 }, 5_000 + 30 * 60 * 1000);
  assert.equal(afterWait.activeMs, 4_500);
  assert.equal(afterWait.startedAt, 5_000 + 30 * 60 * 1000);

  const stillWorking = settleActiveClock({ startedAt: 1_000, activeMs: 0, touchedAt: 5_000 }, 5_100);
  assert.equal(stillWorking.startedAt, 1_000);
  assert.equal(stillWorking.activeMs, 0);
});

test("budget buttons are explicit and other replies are left for the model", () => {
  assert.equal(knownBudgetIntent("continue"), "continue");
  assert.equal(knownBudgetIntent("Keep going"), "continue");
  assert.equal(knownBudgetIntent("stop"), "stop");
  assert.equal(knownBudgetIntent("Stop here"), "stop");
  assert.equal(knownBudgetIntent("yes"), null);
  assert.equal(knownBudgetIntent("please cancel"), null);
  assert.equal(budgetIntentFromModel("stop"), "stop");
  assert.equal(budgetIntentFromModel("continue and check the archive"), "continue");
});
