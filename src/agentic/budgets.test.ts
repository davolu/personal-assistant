import assert from "node:assert/strict";
import test from "node:test";
import { approachKey, budgetIntentFromModel, COMPUTER_STEP_BUDGET, knownBudgetIntent, overApproachBudget, pauseActiveClock, readBudgets, rememberApproach, settleActiveClock } from "./budgets";

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

test("failed approaches count the tool, not each query", () => {
  const veo = "Veo 3 API pricing per second Runway Gen-4 API key";
  const flux = "Flux Kontext character consistency API pricing";
  assert.equal(approachKey("web_search", { query: veo }), "web_search");
  assert.equal(approachKey("web_search", { query: flux }), approachKey("web_search", { query: veo }));
  assert.equal(approachKey("search_web", { query: veo, provider: "duckduckgo" }), "search_web");
  assert.equal(approachKey("search_web", { query: flux, provider: "duckduckgo_lite" }), "search_web");
  assert.equal(approachKey("search_web", { query: flux, provider: "wikipedia" }), "search_web");
  assert.equal(approachKey("fetch_url", { url: "https://docs.dev.runwayml.com/guides/pricing/" }), "fetch_url");
  assert.equal(approachKey("fetch_url", { url: "https://en.wikipedia.org/wiki/Runway_(company)" }), "fetch_url");
  assert.equal(approachKey("research", { goal: veo }), "research");
  assert.equal(approachKey("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL" }] }), "execute:GMAIL_SEND_EMAIL");
  assert.notEqual(
    approachKey("execute_tools", { tools: [{ tool_slug: "GMAIL_SEND_EMAIL" }] }),
    approachKey("execute_tools", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS" }] })
  );

  let approaches: string[] = [];
  for (const key of [
    approachKey("web_search", { query: veo }),
    approachKey("web_search", { query: flux }),
    approachKey("search_web", { query: veo, provider: "duckduckgo" }),
    approachKey("search_web", { query: flux, provider: "duckduckgo" }),
  ]) {
    approaches = rememberApproach(approaches, key);
  }
  assert.deepEqual(approaches, ["web_search", "search_web"]);
  assert.equal(overApproachBudget(approaches, readBudgets()), false);
  approaches = rememberApproach(approaches, approachKey("fetch_url", { url: "https://docs.dev.runwayml.com/guides/pricing/" }));
  assert.equal(overApproachBudget(approaches, readBudgets()), true);
});

test("the computer step budget is one named cap", () => {
  assert.equal(COMPUTER_STEP_BUDGET, 36);
  assert.equal(readBudgets({}).computerSteps, COMPUTER_STEP_BUDGET);
  assert.equal(readBudgets({ AGENTIC_COMPUTER_STEPS: "12" }).computerSteps, COMPUTER_STEP_BUDGET);
  assert.equal(readBudgets({ AGENTIC_COMPUTER_STEPS: "500" }).computerSteps, COMPUTER_STEP_BUDGET);
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
