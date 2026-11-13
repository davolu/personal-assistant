/**
 * Provider list prices for credit metering. 1 credit = $0.01 of provider cost.
 * Verified 2026-11-13. Do not guess a missing slug — leave it out of this table.
 *
 * Sources:
 * - https://platform.claude.com/docs/en/about-claude/pricing
 * - https://developers.openai.com/api/docs/pricing
 * - https://developers.openai.com/api/docs/models/gpt-5.6-sol (gpt-5.6 alias routes to GPT-5.6 Sol)
 * - https://developers.openai.com/api/docs/models/o4-mini
 * - https://e2b.dev/pricing
 * - https://docs.e2b.dev/faq/calculate-sandbox-price
 * - https://platform.claude.com/docs/en/about-claude/pricing (web search: $10 / 1,000 searches)
 * - https://developers.openai.com/api/docs/pricing (web search: $10 / 1,000 calls)
 *
 * Rates are USD per 1,000,000 tokens unless noted.
 * OpenAI long-context rates apply to the whole request when input tokens exceed the threshold.
 * Anthropic Haiku 5.5 steps up for the whole request once the prompt exceeds 100,000 tokens.
 * Cache-write rates are the 5-minute ephemeral write (1.25x base input) where the provider publishes one.
 * computer-use-preview is omitted: OpenAI shut it down on 2026-07-23 and it is not on the current price table.
 * Google, xAI, Mistral, DeepSeek, Groq, and OpenRouter slugs are omitted on purpose.
 */

export type TokenRates = {
  /** USD per 1M uncached input tokens. */
  inputPerMillion: number;
  /** USD per 1M cached input tokens (cache reads). */
  cachedInputPerMillion: number;
  /** USD per 1M output tokens. Reasoning tokens are output. */
  outputPerMillion: number;
  /** USD per 1M cache-write tokens. When omitted, writes are billed at the input rate. */
  cacheWritePerMillion?: number;
};

export type ModelPrice = TokenRates & {
  /** When total input tokens (fresh + cache read + cache write) exceed this, `long` prices the whole call. */
  longContextTokens?: number;
  long?: TokenRates;
};

export const PRICE_VERIFIED_ON = "2026-11-13";

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { inputPerMillion: 4, cachedInputPerMillion: 0.2, cacheWritePerMillion: 5, outputPerMillion: 20 },
  "claude-opus-4-8": { inputPerMillion: 5, cachedInputPerMillion: 0.5, cacheWritePerMillion: 6.25, outputPerMillion: 25 },
  "claude-sonnet-5-5": { inputPerMillion: 2, cachedInputPerMillion: 0.1, cacheWritePerMillion: 2.5, outputPerMillion: 10 },
  "claude-sonnet-4-6": { inputPerMillion: 3, cachedInputPerMillion: 0.3, cacheWritePerMillion: 3.75, outputPerMillion: 15 },
  "claude-sonnet-4-5": { inputPerMillion: 3, cachedInputPerMillion: 0.3, cacheWritePerMillion: 3.75, outputPerMillion: 15 },
  "claude-haiku-5-5": {
    inputPerMillion: 0.1,
    cachedInputPerMillion: 0.01,
    cacheWritePerMillion: 0.125,
    outputPerMillion: 0.5,
    longContextTokens: 100_000,
    long: { inputPerMillion: 0.5, cachedInputPerMillion: 0.05, cacheWritePerMillion: 0.625, outputPerMillion: 2.5 },
  },
  "claude-haiku-4-5": { inputPerMillion: 1, cachedInputPerMillion: 0.1, cacheWritePerMillion: 1.25, outputPerMillion: 5 },

  // Official alias of gpt-5.6-sol. Promotional rates through 2026-11-30. Long context is 2x input and 1.5x output.
  "gpt-5.6": {
    inputPerMillion: 4,
    cachedInputPerMillion: 0.4,
    cacheWritePerMillion: 5,
    outputPerMillion: 20,
    longContextTokens: 272_000,
    long: { inputPerMillion: 8, cachedInputPerMillion: 0.8, cacheWritePerMillion: 10, outputPerMillion: 30 },
  },
  "gpt-5.4": {
    inputPerMillion: 2.5,
    cachedInputPerMillion: 0.25,
    outputPerMillion: 15,
    longContextTokens: 272_000,
    long: { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 22.5 },
  },
  "gpt-5.4-mini": { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 },
  "gpt-5.4-nano": { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 },
  "gpt-5-mini": { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 },
  "gpt-5-nano": { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.4 },
  o3: { inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
  "o4-mini": { inputPerMillion: 1.1, cachedInputPerMillion: 0.275, outputPerMillion: 4.4 },
};

/**
 * Published web-search tool fee, $10 per 1,000 searches, on both OpenAI and Anthropic.
 * AgentDocker's web_search tool is Composio's COMPOSIO_SEARCH_WEB. Composio does not
 * publish a per-search price, so this rate is the floor that keeps a search from being free.
 * Override with WEB_SEARCH_USD when the Composio invoice shows a different unit cost.
 */
export const WEB_SEARCH_USD_DEFAULT = 0.01;

/**
 * E2B bills a running sandbox per second: $0.000014 per vCPU and $0.0000045 per GiB.
 * The pricing-page default is 2 vCPU and 4 GiB = $0.000046/s = $0.1656/hour ≈ 16.56 credits/hour.
 * Paused sandboxes are not billed. Override with E2B_USD_PER_SECOND if the desktop template is a different size.
 */
export const E2B_USD_PER_SECOND_DEFAULT = 0.000046;

export function priceForSlug(slug: string | null | undefined): ModelPrice | null {
  const key = slug?.trim() ?? "";
  if (!key) return null;
  return MODEL_PRICES[key] ?? null;
}

export function isBillableSlug(slug: string | null | undefined): boolean {
  return priceForSlug(slug) != null;
}
