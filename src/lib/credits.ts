import { PLANS, type PlanKey } from "@/lib/site";
import {
  E2B_USD_PER_SECOND_DEFAULT,
  WEB_SEARCH_USD_DEFAULT,
  priceForSlug,
  type ModelPrice,
  type TokenRates,
} from "@/lib/model-prices";

/** 1 credit = $0.01. Stored credits keep 6 decimal places (1e-6 credit = $1e-8). */
export const CREDITS_PER_USD = 100;
const CREDIT_MICROS = 1_000_000;

export type ModelTier = "cheap" | "standard" | "premium";

const TIER_RANK: Record<ModelTier, number> = { cheap: 0, standard: 1, premium: 2 };

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

export type RawUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  /** AI SDK LanguageModelUsage.inputTokenDetails. When present, it wins over the flat fields. */
  noCacheTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export function roundCredits(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value * CREDIT_MICROS - 1e-9) / CREDIT_MICROS;
}

export function creditsFromUsd(usd: number): number {
  return roundCredits(usd * CREDITS_PER_USD);
}

export function usdFromCredits(credits: number): number {
  return credits / CREDITS_PER_USD;
}

function ratesFor(price: ModelPrice, usage: TokenUsage): TokenRates {
  const prompt = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  if (price.long && price.longContextTokens && prompt > price.longContextTokens) return price.long;
  return price;
}

/** Credits for one model call. Rounds up so a fractional token never bills at zero. */
export function creditsForUsage(slug: string, usage: TokenUsage): { credits: number; costUsd: number } | null {
  const price = priceForSlug(slug);
  if (!price) return null;
  const rates = ratesFor(price, usage);
  const writeRate = rates.cacheWritePerMillion ?? rates.inputPerMillion;
  const micros =
    tokenMicros(usage.inputTokens, rates.inputPerMillion) +
    tokenMicros(usage.cachedInputTokens, rates.cachedInputPerMillion) +
    tokenMicros(usage.cacheWriteTokens, writeRate) +
    tokenMicros(usage.outputTokens, rates.outputPerMillion);
  const credits = micros / CREDIT_MICROS;
  return { credits, costUsd: credits / CREDITS_PER_USD };
}

function tokenMicros(tokens: number, usdPerMillion: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(usdPerMillion) || usdPerMillion <= 0) return 0;
  return Math.ceil(tokens * usdPerMillion * CREDITS_PER_USD - 1e-9);
}

/**
 * Normalize provider usage into uncached input, cache read, cache write, and output.
 * OpenAI's prompt_tokens include cached tokens. Anthropic's input_tokens do not.
 * The AI SDK reports both, and inputTokenDetails.noCacheTokens is the uncached count.
 */
export function normalizeUsage(raw: RawUsage | null | undefined, provider: "openai" | "anthropic" | "sdk" | string = "sdk"): TokenUsage {
  const source = raw ?? {};
  if (source.noCacheTokens != null || (provider === "sdk" && source.inputTokens != null && source.cachedInputTokens != null && source.noCacheTokens !== undefined)) {
    return positiveUsage({
      inputTokens: source.noCacheTokens ?? 0,
      cachedInputTokens: source.cachedInputTokens ?? 0,
      cacheWriteTokens: source.cacheWriteTokens ?? 0,
      outputTokens: source.outputTokens ?? 0,
    });
  }
  if (provider === "anthropic" || source.input_tokens != null || source.cache_read_input_tokens != null) {
    return positiveUsage({
      inputTokens: source.input_tokens ?? source.inputTokens ?? 0,
      cachedInputTokens: source.cache_read_input_tokens ?? source.cachedInputTokens ?? 0,
      cacheWriteTokens: source.cache_creation_input_tokens ?? source.cacheWriteTokens ?? 0,
      outputTokens: source.output_tokens ?? source.outputTokens ?? 0,
    });
  }
  const prompt = source.promptTokens ?? source.inputTokens ?? 0;
  const cached = source.cachedInputTokens ?? 0;
  const cacheWrite = source.cacheWriteTokens ?? 0;
  const input = provider === "openai" || source.promptTokens != null ? Math.max(0, prompt - cached - cacheWrite) : prompt;
  return positiveUsage({
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteTokens: cacheWrite,
    outputTokens: source.completionTokens ?? source.outputTokens ?? 0,
  });
}

export function usageFromUnknown(value: unknown): { usage: TokenUsage; provider: string } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const details = raw.inputTokenDetails as Record<string, unknown> | undefined;
  if (details && (details.noCacheTokens != null || details.cacheReadTokens != null || details.cacheWriteTokens != null)) {
    return {
      provider: "sdk",
      usage: normalizeUsage(
        {
          noCacheTokens: numberOrZero(details.noCacheTokens),
          cachedInputTokens: numberOrZero(details.cacheReadTokens),
          cacheWriteTokens: numberOrZero(details.cacheWriteTokens),
          outputTokens: numberOrZero(raw.outputTokens),
        },
        "sdk"
      ),
    };
  }
  if ("input_tokens" in raw || "cache_read_input_tokens" in raw || "cache_creation_input_tokens" in raw) {
    return {
      provider: "anthropic",
      usage: normalizeUsage(
        {
          input_tokens: numberOrZero(raw.input_tokens),
          output_tokens: numberOrZero(raw.output_tokens),
          cache_read_input_tokens: numberOrZero(raw.cache_read_input_tokens),
          cache_creation_input_tokens: numberOrZero(raw.cache_creation_input_tokens),
        },
        "anthropic"
      ),
    };
  }
  if ("prompt_tokens" in raw || "completion_tokens" in raw) {
    const promptDetails = raw.prompt_tokens_details as Record<string, unknown> | undefined;
    return {
      provider: "openai",
      usage: normalizeUsage(
        {
          promptTokens: numberOrZero(raw.prompt_tokens),
          completionTokens: numberOrZero(raw.completion_tokens),
          cachedInputTokens: numberOrZero(promptDetails?.cached_tokens),
          cacheWriteTokens: numberOrZero(promptDetails?.cache_write_tokens),
        },
        "openai"
      ),
    };
  }
  if ("inputTokens" in raw || "outputTokens" in raw) {
    return {
      provider: "openai",
      usage: normalizeUsage(
        {
          inputTokens: numberOrZero(raw.inputTokens),
          outputTokens: numberOrZero(raw.outputTokens),
          cachedInputTokens: numberOrZero(raw.cachedInputTokens),
          cacheWriteTokens: numberOrZero(raw.cacheWriteTokens),
        },
        "openai"
      ),
    };
  }
  return null;
}

function positiveUsage(usage: TokenUsage): TokenUsage {
  return {
    inputTokens: nonNegative(usage.inputTokens),
    cachedInputTokens: nonNegative(usage.cachedInputTokens),
    cacheWriteTokens: nonNegative(usage.cacheWriteTokens),
    outputTokens: nonNegative(usage.outputTokens),
  };
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function webSearchUsd(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.WEB_SEARCH_USD);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : WEB_SEARCH_USD_DEFAULT;
}

export function webSearchCredits(env: Record<string, string | undefined> = process.env): number {
  return creditsFromUsd(webSearchUsd(env));
}

export function desktopUsdPerSecond(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.E2B_USD_PER_SECOND);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : E2B_USD_PER_SECOND_DEFAULT;
}

export function desktopCredits(seconds: number, env: Record<string, string | undefined> = process.env): { credits: number; costUsd: number } {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const costUsd = safeSeconds * desktopUsdPerSecond(env);
  return { credits: creditsFromUsd(costUsd), costUsd };
}

/** A short cheap-model run used only for the pricing-page example. */
export const TYPICAL_CHEAP_RUN = {
  slug: "claude-haiku-5-5",
  calls: 8,
  inputTokens: 6_000,
  cachedInputTokens: 12_000,
  outputTokens: 700,
  searches: 1,
} as const;

export function typicalCheapRunCredits(env: Record<string, string | undefined> = {}): number {
  const call = creditsForUsage(TYPICAL_CHEAP_RUN.slug, {
    inputTokens: TYPICAL_CHEAP_RUN.inputTokens,
    cachedInputTokens: TYPICAL_CHEAP_RUN.cachedInputTokens,
    cacheWriteTokens: 0,
    outputTokens: TYPICAL_CHEAP_RUN.outputTokens,
  });
  const model = (call?.credits ?? 0) * TYPICAL_CHEAP_RUN.calls;
  const search = webSearchCredits(env) * TYPICAL_CHEAP_RUN.searches;
  return roundCredits(model + search);
}

export function typicalRuns(credits: number, env: Record<string, string | undefined> = {}): number {
  const each = typicalCheapRunCredits(env);
  if (each <= 0) return 0;
  return Math.floor(credits / each);
}

export function tierAllows(maxTier: ModelTier, tier: ModelTier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[maxTier];
}

export function planKeyOf(value: string | null | undefined): PlanKey {
  return value && value in PLANS ? (value as PlanKey) : "free";
}

export function modelAllowed(input: { billable: boolean; tier: ModelTier; plan: string; id?: string }): { ok: true } | { ok: false; error: string } {
  if (!input.billable) return { ok: false, error: "That model is not available." };
  const plan = planKeyOf(input.plan);
  if (tierAllows(PLANS[plan].maxTier, input.tier)) return { ok: true };
  if (input.id && isExtraModel(plan, input.id)) return { ok: true };
  return { ok: false, error: "That model is not included in your plan." };
}

function isExtraModel(plan: PlanKey, id: string): boolean {
  for (const extra of PLANS[plan].extraModels) {
    if (extra === id) return true;
  }
  return false;
}

export function planAllowsDesktop(plan: string): boolean {
  return PLANS[planKeyOf(plan)].desktop;
}

export function desktopLockedMessage(): string {
  return `The cloud desktop is on paid plans. Your chat is saved. [Upgrade](${pricingUrl()}) to continue on the desktop.`;
}

export function creditsExhaustedText(): string {
  return "I stopped because this account is out of credits. Your chat is saved.";
}

export function creditsExhaustedMessage(): string {
  return `${creditsExhaustedText()} [Top up or upgrade](${pricingUrl()}) to continue.`;
}

export function runBudgetMessage(): string {
  return "I stopped because this run reached its cost limit. Your chat is saved. Send another message to continue.";
}

export function verifyEmailMessage(resendConfigured: boolean): string {
  if (resendConfigured) return "Verify your email to use free credits. Check your inbox for the link, then try again.";
  return "Free credits need a verified Google sign-in. Continue with Google, or upgrade to a paid plan.";
}

export function concurrencyMessage(limit: number): string {
  return `${limit} runs are already active on this account. Wait for one to finish, then try again.`;
}

export function rateLimitMessage(): string {
  return "Too many runs started in the last hour. Wait a little and try again.";
}

export function pricingUrl(): string {
  return `https://agentdocker.io/pricing`;
}

export function isLowBalance(remaining: number, allowance: number): boolean {
  if (remaining <= 0) return false;
  const floor = Math.max(10, allowance * 0.15);
  return remaining <= floor;
}

export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 100) return Math.round(value).toLocaleString("en-US");
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/**
 * Existing run quotas map onto the new credit allowance by the unused fraction.
 * A starter user with 750 of 1,000 runs left receives 75% of 1,100 credits.
 * Top-up credits are separate and are not part of this grant.
 */
export function migratedPlanCredits(input: { plan: string; runsQuota: number; runsUsed: number }): number {
  const allowance = PLANS[planKeyOf(input.plan)].credits;
  const quota = input.runsQuota > 0 ? input.runsQuota : allowance;
  const remaining = Math.max(0, quota - Math.max(0, input.runsUsed));
  const ratio = Math.min(1, remaining / quota);
  return roundCredits(allowance * ratio);
}

/** Spend monthly plan credits first. Top-up credits are what remains. */
export function splitSpend(planBalance: number, topupBalance: number, cost: number): {
  plan: number;
  topup: number;
  charged: number;
  remaining: number;
} {
  const plan = Math.max(0, planBalance);
  const topup = Math.max(0, topupBalance);
  const need = Math.max(0, cost);
  const fromPlan = Math.min(plan, need);
  const fromTop = Math.min(topup, roundCredits(need - fromPlan));
  const charged = roundCredits(fromPlan + fromTop);
  return {
    plan: roundCredits(plan - fromPlan),
    topup: roundCredits(topup - fromTop),
    charged,
    remaining: roundCredits(plan + topup - charged),
  };
}

export type AdmissionInput = {
  balance: number;
  freeEligible: boolean;
  activeRuns: number;
  recentStarts: number;
  maxConcurrent: number;
  maxPerHour: number;
  rate: boolean;
};

export function decideAdmission(input: AdmissionInput): { ok: true } | { ok: false; code: "credits" | "verify" | "concurrency" | "rate"; message: string } {
  if (!input.freeEligible) return { ok: false, code: "verify", message: verifyEmailMessage(false) };
  if (input.balance <= 0) return { ok: false, code: "credits", message: creditsExhaustedMessage() };
  if (input.activeRuns >= input.maxConcurrent) return { ok: false, code: "concurrency", message: concurrencyMessage(input.maxConcurrent) };
  if (input.rate && input.recentStarts >= input.maxPerHour) return { ok: false, code: "rate", message: rateLimitMessage() };
  return { ok: true };
}

export function shouldAlertDailySpend(spentUsd: number, thresholdUsd: number, alreadySent: boolean): boolean {
  return thresholdUsd > 0 && spentUsd >= thresholdUsd && !alreadySent;
}

export function readCreditLimits(env: Record<string, string | undefined> = process.env): {
  maxConcurrent: number;
  maxPerHour: number;
  dailySpendUsd: number;
  alertEmail: string;
} {
  return {
    maxConcurrent: positiveInt(env.AGENTIC_MAX_CONCURRENT, 2),
    maxPerHour: positiveInt(env.AGENTIC_MAX_RUNS_PER_HOUR, 30),
    dailySpendUsd: nonNegativeOr(env.OWNER_DAILY_SPEND_USD, 25),
    alertEmail: env.OWNER_ALERT_EMAIL?.trim() ?? "",
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function nonNegativeOr(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
}
