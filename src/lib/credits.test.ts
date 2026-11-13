import assert from "node:assert/strict";
import test from "node:test";
import { PLANS } from "./site";
import {
  creditsForUsage,
  decideAdmission,
  desktopCredits,
  formatCredits,
  isLowBalance,
  migratedPlanCredits,
  modelAllowed,
  normalizeUsage,
  planAllowsDesktop,
  shouldAlertDailySpend,
  splitSpend,
  typicalCheapRunCredits,
  typicalRuns,
  usageFromUnknown,
  webSearchCredits,
} from "./credits";

test("token prices convert to credits at one cent each and round up", () => {
  const haiku = creditsForUsage("claude-haiku-5-5", { inputTokens: 100_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  assert.equal(haiku?.credits, 1);
  assert.equal(haiku?.costUsd, 0.01);
  const cached = creditsForUsage("claude-haiku-5-5", { inputTokens: 0, cachedInputTokens: 100_000, cacheWriteTokens: 0, outputTokens: 0 });
  assert.equal(cached?.credits, 0.1);
  const output = creditsForUsage("claude-haiku-5-5", { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 100_000 });
  assert.equal(output?.credits, 5);
  const write = creditsForUsage("claude-haiku-5-5", { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 100_000, outputTokens: 0 });
  assert.equal(write?.credits, 1.25);
  const long = creditsForUsage("claude-haiku-5-5", { inputTokens: 100_001, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  assert.ok(long && long.credits > 5 && long.credits < 5.01);
  const flagship = creditsForUsage("gpt-5.6", { inputTokens: 1_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000 });
  assert.equal(flagship?.credits, 2.4);
  const longFlagship = creditsForUsage("gpt-5.6", { inputTokens: 272_001, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  assert.ok(longFlagship && Math.abs(longFlagship.credits - 217.6008) < 0.001);
  assert.equal(creditsForUsage("computer-use-preview", { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 }), null);
  assert.equal(creditsForUsage("gemini-2.5-flash", { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 }), null);
});

test("provider usage shapes split cached tokens out of the input total", () => {
  const openai = usageFromUnknown({ prompt_tokens: 1_000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 250, cache_write_tokens: 50 } });
  assert.deepEqual(openai?.usage, { inputTokens: 700, cachedInputTokens: 250, cacheWriteTokens: 50, outputTokens: 40 });
  const anthropic = usageFromUnknown({ input_tokens: 700, output_tokens: 40, cache_read_input_tokens: 250, cache_creation_input_tokens: 50 });
  assert.deepEqual(anthropic?.usage, { inputTokens: 700, cachedInputTokens: 250, cacheWriteTokens: 50, outputTokens: 40 });
  const sdk = usageFromUnknown({
    inputTokens: 1_000,
    outputTokens: 40,
    inputTokenDetails: { noCacheTokens: 700, cacheReadTokens: 250, cacheWriteTokens: 50 },
  });
  assert.deepEqual(sdk?.usage, { inputTokens: 700, cachedInputTokens: 250, cacheWriteTokens: 50, outputTokens: 40 });
  assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 }, "openai"), {
    inputTokens: 6,
    cachedInputTokens: 4,
    cacheWriteTokens: 0,
    outputTokens: 2,
  });
});

test("web search and desktop seconds use the published rates", () => {
  assert.equal(webSearchCredits({}), 1);
  const hour = desktopCredits(3600, {});
  assert.ok(Math.abs(hour.credits - 16.56) < 0.001);
  assert.ok(Math.abs(hour.costUsd - 0.1656) < 0.000001);
  const custom = desktopCredits(10, { E2B_USD_PER_SECOND: "0.001" });
  assert.equal(custom.credits, 1);
});

test("plan gates, desktop, and migration follow the credit allowances", () => {
  assert.equal(modelAllowed({ billable: true, tier: "cheap", plan: "free" }).ok, true);
  assert.equal(modelAllowed({ billable: true, tier: "standard", plan: "free" }).ok, false);
  assert.equal(modelAllowed({ billable: true, tier: "premium", plan: "free", id: "claude-sonnet-5-5" }).ok, true);
  assert.equal(modelAllowed({ billable: true, tier: "premium", plan: "free", id: "claude-opus-5-5" }).ok, false);
  assert.equal(modelAllowed({ billable: false, tier: "premium", plan: "free", id: "claude-sonnet-5-5" }).ok, false);
  assert.equal(modelAllowed({ billable: true, tier: "premium", plan: "starter" }).ok, true);
  assert.equal(modelAllowed({ billable: false, tier: "cheap", plan: "scale" }).ok, false);
  assert.equal(planAllowsDesktop("free"), false);
  assert.equal(planAllowsDesktop("pro"), true);
  assert.equal(migratedPlanCredits({ plan: "starter", runsQuota: 1000, runsUsed: 250 }), 825);
  assert.equal(migratedPlanCredits({ plan: "free", runsQuota: 50, runsUsed: 0 }), PLANS.free.credits);
  assert.equal(migratedPlanCredits({ plan: "pro", runsQuota: 5000, runsUsed: 5000 }), 0);
  assert.equal(PLANS.starter.credits, 1100);
  assert.equal(PLANS.pro.credits, 3000);
  assert.equal(PLANS.scale.credits, 8000);
});

test("spend uses monthly credits before top-ups and admission stops at the edges", () => {
  assert.deepEqual(splitSpend(10, 5, 12), { plan: 0, topup: 3, charged: 12, remaining: 3 });
  assert.deepEqual(splitSpend(2, 2, 10), { plan: 0, topup: 0, charged: 4, remaining: 0 });
  const broke = decideAdmission({ balance: 0, freeEligible: true, activeRuns: 0, recentStarts: 0, maxConcurrent: 2, maxPerHour: 30, rate: true });
  assert.equal(broke.ok, false);
  if (!broke.ok) assert.equal(broke.code, "credits");
  const busy = decideAdmission({ balance: 20, freeEligible: true, activeRuns: 2, recentStarts: 0, maxConcurrent: 2, maxPerHour: 30, rate: true });
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.code, "concurrency");
  const fast = decideAdmission({ balance: 20, freeEligible: true, activeRuns: 0, recentStarts: 30, maxConcurrent: 2, maxPerHour: 30, rate: true });
  assert.equal(fast.ok, false);
  if (!fast.ok) assert.equal(fast.code, "rate");
  const unverified = decideAdmission({ balance: 20, freeEligible: false, activeRuns: 0, recentStarts: 0, maxConcurrent: 2, maxPerHour: 30, rate: true });
  assert.equal(unverified.ok, false);
  if (!unverified.ok) assert.equal(unverified.code, "verify");
  assert.equal(decideAdmission({ balance: 20, freeEligible: true, activeRuns: 1, recentStarts: 3, maxConcurrent: 2, maxPerHour: 30, rate: true }).ok, true);
  assert.equal(isLowBalance(7, 50), true);
  assert.equal(isLowBalance(0, 50), false);
  assert.equal(isLowBalance(40, 50), false);
  assert.equal(shouldAlertDailySpend(25, 25, false), true);
  assert.equal(shouldAlertDailySpend(25, 25, true), false);
  assert.equal(shouldAlertDailySpend(10, 0, false), false);
  assert.ok(typicalCheapRunCredits() > 0);
  assert.equal(typicalRuns(PLANS.free.credits), Math.floor(PLANS.free.credits / typicalCheapRunCredits()));
  assert.match(formatCredits(12.34), /12\.3/);
});
