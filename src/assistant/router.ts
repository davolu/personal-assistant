import type { ModelRole } from "./types";

export type RouteChoice = {
  provider: "anthropic" | "openai" | "none";
  model: string;
  tier: "strong" | "cheap" | "embed";
};

export type RouterEnv = {
  strongModel?: string;
  cheapModel?: string;
  fallbackModel?: string;
  embeddingModel?: string;
  hasAnthropic?: boolean;
  hasOpenAI?: boolean;
};

/**
 * Code picks the model (Ch52). Planning and tool use go to the strong model.
 * Classification and summaries go to the cheap model. Embeddings are a third path.
 */
export function routeRole(role: ModelRole, env: RouterEnv = {}): RouteChoice {
  const strong = env.strongModel || "claude-sonnet-4-5";
  const cheap = env.cheapModel || "claude-haiku-4-5";
  const embed = env.embeddingModel || "text-embedding-3-small";
  if (role === "embed") {
    return { provider: env.hasOpenAI === false ? "none" : "openai", model: embed, tier: "embed" };
  }
  const tier = role === "plan" || role === "act" ? "strong" : "cheap";
  const model = tier === "strong" ? strong : cheap;
  if (env.hasAnthropic === false && env.hasOpenAI) {
    return { provider: "openai", model: env.fallbackModel || "gpt-4o-mini", tier };
  }
  return { provider: "anthropic", model, tier };
}

export const FALLBACK_STATUSES = new Set([408, 409, 429, 500, 502, 503, 529]);
