import { modelAllowed, planKeyOf, type ModelTier } from "@/lib/credits";
import { isBillableSlug } from "@/lib/model-prices";

/**
 * One list of chat models. Add a row here, or pass extra rows in AGENTIC_MODELS.
 * Slugs come from the installed AI SDK provider types and the provider docs.
 * AGENTIC_DEFAULT_MODEL or ANTHROPIC_MODEL chooses the default when that slug is billable and the plan allows it.
 * Otherwise Sonnet 5.5 is the default when it is available, billable, and allowed.
 * If it is not, a cheap billable model the plan allows is the default. Unpriced slugs stay in the list and cannot be selected.
 */

export type ModelCapabilities = {
  tools: boolean;
  thinking: boolean;
  computer: boolean;
  promptCache: boolean;
  vision: boolean;
};

export type ModelProvider = "anthropic" | "openai" | "google" | "xai" | "mistral" | "deepseek" | "groq" | "openrouter";

export type RegistryModel = {
  id: string;
  provider: ModelProvider;
  label: string;
  model: string;
  env: string;
  hint: string;
  tier: ModelTier;
  capabilities: ModelCapabilities;
};

export type PublicModel = {
  id: string;
  provider: ModelProvider;
  label: string;
  model: string;
  env: string;
  hint: string;
  tier: ModelTier;
  /** False when this slug has no verified provider price. Those models cannot be selected. */
  billable: boolean;
  available: boolean;
  /** True when the key is set but the plan or the price table blocks the model. The picker greys these out. */
  locked: boolean;
  capabilities: ModelCapabilities;
};

export const CLAUDE_MODEL_ID = "claude-sonnet-5-5";

const PROVIDER_ENV: Record<ModelProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

type Caps = Partial<ModelCapabilities>;

function entry(id: string, provider: ModelProvider, label: string, model: string, hint: string, caps: Caps = {}, tier: ModelTier = "premium"): RegistryModel {
  return {
    id,
    provider,
    label,
    model,
    env: PROVIDER_ENV[provider],
    hint,
    tier,
    capabilities: {
      tools: true,
      thinking: false,
      computer: false,
      promptCache: provider === "anthropic",
      vision: false,
      ...caps,
    },
  };
}

const claude = (id: string, label: string, model: string, hint: string, tier: ModelTier = "premium", caps: Caps = {}): RegistryModel =>
  entry(id, "anthropic", label, model, hint, { thinking: true, vision: true, computer: true, ...caps }, tier);

/** Built-in rows. Slugs are the undated aliases from @ai-sdk/* and the provider API docs. */
export const MODEL_REGISTRY: readonly RegistryModel[] = [
  claude("claude-opus-5-5", "Opus 5.5", "claude-opus-5-5", "Deep · higher cost · reasoning · vision · computer"),
  claude("claude-opus-4-8", "Opus 4.8", "claude-opus-4-8", "Deep · higher cost · reasoning · vision · computer"),
  claude(CLAUDE_MODEL_ID, "Sonnet 5.5", "claude-sonnet-5-5", "Balanced · reasoning · vision · computer"),
  claude("claude-sonnet-4-6", "Sonnet 4.6", "claude-sonnet-4-6", "Balanced · reasoning · vision · computer"),
  claude("claude-sonnet-4-5", "Sonnet 4.5", "claude-sonnet-4-5", "Balanced · reasoning · vision · computer"),
  claude("claude-haiku-5-5", "Haiku 5.5", "claude-haiku-5-5", "Fast · lower cost · reasoning · vision · computer", "cheap"),
  claude("claude-haiku-4-5", "Haiku 4.5", "claude-haiku-4-5", "Fast · lower cost · reasoning · vision · computer", "standard"),

  entry("gpt-5.6", "openai", "GPT-5.6", "gpt-5.6", "Flagship · higher cost · reasoning · vision", { thinking: true, vision: true }, "premium"),
  entry("gpt-5.4", "openai", "GPT-5.4", "gpt-5.4", "Flagship · reasoning · vision", { thinking: true, vision: true }, "premium"),
  entry("gpt-5.4-mini", "openai", "GPT-5.4 mini", "gpt-5.4-mini", "Fast · lower cost · reasoning · vision", { thinking: true, vision: true }, "standard"),
  entry("gpt-5.4-nano", "openai", "GPT-5.4 nano", "gpt-5.4-nano", "Fastest · lower cost · reasoning · vision", { thinking: true, vision: true }, "cheap"),
  entry("gpt-5-mini", "openai", "GPT-5 mini", "gpt-5-mini", "Fast · lower cost · reasoning · vision", { thinking: true, vision: true }, "cheap"),
  entry("gpt-5-nano", "openai", "GPT-5 nano", "gpt-5-nano", "Fastest · lower cost · reasoning · vision", { thinking: true, vision: true }, "cheap"),
  entry("o3", "openai", "o3", "o3", "Slow · reasoning · vision", { thinking: true, vision: true }, "premium"),
  entry("o4-mini", "openai", "o4-mini", "o4-mini", "Fast · reasoning · vision", { thinking: true, vision: true }, "standard"),
  entry("computer-use-preview", "openai", "Computer use", "computer-use-preview", "Desktop · vision · computer", { vision: true, computer: true }),

  entry("gemini-3.1-pro-preview", "google", "Gemini 3.1 Pro", "gemini-3.1-pro-preview", "Deep · reasoning · vision", { thinking: true, vision: true }),
  entry("gemini-3.5-flash", "google", "Gemini 3.5 Flash", "gemini-3.5-flash", "Fast · balanced · vision", { vision: true }),
  entry("gemini-3.5-flash-lite", "google", "Gemini 3.5 Flash-Lite", "gemini-3.5-flash-lite", "Fastest · lower cost · vision", { vision: true }),
  entry("gemini-2.5-pro", "google", "Gemini 2.5 Pro", "gemini-2.5-pro", "Deep · reasoning · vision", { thinking: true, vision: true }),
  entry("gemini-2.5-flash", "google", "Gemini 2.5 Flash", "gemini-2.5-flash", "Fast · balanced · vision", { vision: true }),
  entry("gemini-2.5-flash-lite", "google", "Gemini 2.5 Flash-Lite", "gemini-2.5-flash-lite", "Fastest · lower cost · vision", { vision: true }),

  entry("grok-4.7", "xai", "Grok 4.7", "grok-4.7", "Flagship · reasoning · vision", { thinking: true, vision: true }),
  entry("grok-4.20-non-reasoning", "xai", "Grok 4.20 fast", "grok-4.20-non-reasoning", "Fast · lower cost"),
  entry("grok-latest", "xai", "Grok latest", "grok-latest", "Flagship alias"),

  entry("mistral-large-latest", "mistral", "Mistral Large", "mistral-large-latest", "Flagship · higher cost"),
  entry("mistral-medium-latest", "mistral", "Mistral Medium", "mistral-medium-latest", "Balanced"),
  entry("mistral-small-latest", "mistral", "Mistral Small", "mistral-small-latest", "Fast · lower cost"),

  entry("deepseek-v4-pro", "deepseek", "DeepSeek V4 Pro", "deepseek-v4-pro", "Deep · reasoning", { thinking: true }),
  entry("deepseek-flash", "deepseek", "DeepSeek Flash", "deepseek-flash", "Fast · lower cost · reasoning · vision", { thinking: true, vision: true }),

  entry("groq-llama-4-maverick", "groq", "Llama 4 Maverick", "meta-llama/llama-4-maverick-17b-128e-instruct", "Fast · hosted · vision", { vision: true }),
  entry("groq-llama-3.3-70b", "groq", "Llama 3.3 70B", "llama-3.3-70b-versatile", "Fast · hosted"),
  entry("groq-qwen-3.6-27b", "groq", "Qwen 3.6 27B", "qwen/qwen3.6-27b", "Fast · hosted"),

  entry("openrouter-claude-sonnet-4.6", "openrouter", "Claude Sonnet 4.6", "anthropic/claude-sonnet-4.6", "Routed · reasoning · vision", { thinking: true, vision: true }),
  entry("openrouter-gpt-5.4", "openrouter", "GPT-5.4", "openai/gpt-5.4", "Routed · reasoning · vision", { thinking: true, vision: true }),
  entry("openrouter-gemini-2.5-pro", "openrouter", "Gemini 2.5 Pro", "google/gemini-2.5-pro", "Routed · reasoning · vision", { thinking: true, vision: true }),
  entry("openrouter-deepseek-v4-pro", "openrouter", "DeepSeek V4 Pro", "deepseek/deepseek-v4-pro", "Routed · reasoning", { thinking: true }),
];

export function registryModels(env: Record<string, string | undefined> = process.env): RegistryModel[] {
  const builtin = new Set(MODEL_REGISTRY.map((model) => model.id));
  return [...MODEL_REGISTRY, ...customModels(env, builtin)];
}

const CHEAP_PREFERENCE = ["claude-haiku-5-5", "gpt-5-nano", "gpt-5.4-nano", "gpt-5-mini"];

export function listModels(env: Record<string, string | undefined> = process.env, plan?: string): PublicModel[] {
  return registryModels(env).map((model) => {
    const available = hasKey(env, model.env);
    const billable = isBillableSlug(model.model) || isBillableSlug(model.id);
    const allowed = plan ? modelAllowed({ billable, tier: model.tier, plan: planKeyOf(plan), id: model.id }).ok : billable;
    return {
      id: model.id,
      provider: model.provider,
      label: model.label,
      model: model.model,
      env: model.env,
      hint: model.hint,
      tier: model.tier,
      billable,
      available,
      locked: available && !allowed,
      capabilities: model.capabilities,
    };
  });
}

export function defaultModelId(env: Record<string, string | undefined> = process.env, plan?: string): string | null {
  const models = listModels(env, plan);
  const selectable = (model: PublicModel) => model.available && model.billable && !model.locked;
  for (const name of ["AGENTIC_DEFAULT_MODEL", "ANTHROPIC_MODEL"]) {
    const value = env[name]?.trim();
    if (!value) continue;
    const match = models.find((model) => selectable(model) && (model.id === value || model.model === value));
    if (match) return match.id;
  }
  const sonnet = models.find((model) => model.id === CLAUDE_MODEL_ID && selectable(model));
  if (sonnet) return sonnet.id;
  const cheap = models.filter((model) => selectable(model) && model.tier === "cheap");
  for (const id of CHEAP_PREFERENCE) {
    const match = cheap.find((model) => model.id === id);
    if (match) return match.id;
  }
  return cheap[0]?.id ?? null;
}

export function resolveModel(
  id: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): { ok: true; model: PublicModel } | { ok: false; error: string } {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) {
    const fallback = defaultModelId(env);
    if (!fallback) return { ok: false, error: "No model key is set. Add a provider key in the environment." };
    return resolveModel(fallback, env);
  }
  const model = listModels(env).find((item) => item.id === trimmed);
  if (!model) return { ok: false, error: "That model is not in the registry." };
  if (!model.available) return { ok: false, error: `Set ${model.env} to use ${model.label}.` };
  return { ok: true, model };
}

export function allowsComputer(modelId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!modelId) return true;
  const resolved = resolveModel(modelId, env);
  return resolved.ok && resolved.model.capabilities.computer;
}

export function selectTools<T extends { name: string }>(
  modelId: string | null | undefined,
  schemas: readonly T[],
  env: Record<string, string | undefined> = process.env
): readonly T[] {
  if (!modelId) return schemas;
  const resolved = resolveModel(modelId, env);
  if (!resolved.ok) return schemas;
  if (!resolved.model.capabilities.tools) return [];
  if (!resolved.model.capabilities.computer) return schemas.filter((schema) => schema.name !== "use_computer");
  return schemas;
}

export function providerOptionsFor(model: Pick<PublicModel, "provider" | "capabilities">): Record<string, Record<string, unknown>> | undefined {
  if (model.provider !== "anthropic") return undefined;
  const anthropic: Record<string, unknown> = {};
  if (model.capabilities.thinking) anthropic.thinking = { type: "between_tools" };
  if (model.capabilities.promptCache) anthropic.cacheControl = { type: "ephemeral" };
  return Object.keys(anthropic).length ? { anthropic } : undefined;
}

function hasKey(env: Record<string, string | undefined>, name: string): boolean {
  return Boolean(env[name]?.trim());
}

function customModels(env: Record<string, string | undefined>, builtin: Set<string>): RegistryModel[] {
  const raw = env.AGENTIC_MODELS?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const added: RegistryModel[] = [];
  for (const item of parsed) {
    const model = customModel(item, builtin);
    if (!model) continue;
    builtin.add(model.id);
    added.push(model);
  }
  return added;
}

function customModel(item: unknown, builtin: Set<string>): RegistryModel | null {
  if (!item || typeof item !== "object") return null;
  const record = item as { id?: unknown; provider?: unknown; label?: unknown; model?: unknown; hint?: unknown; capabilities?: Caps };
  const provider = record.provider;
  if (!isProvider(provider)) return null;
  const id = clean(record.id, 80);
  const model = clean(record.model, 160);
  const label = clean(record.label, 80);
  if (!id || !model || !label || builtin.has(id)) return null;
  const computer = record.capabilities?.computer === true && (provider === "anthropic" || provider === "openai");
  return entry(id, provider, label, model, clean(record.hint, 120) || "Custom", {
    tools: record.capabilities?.tools !== false,
    thinking: record.capabilities?.thinking === true,
    computer,
    promptCache: provider === "anthropic" && record.capabilities?.promptCache !== false,
    vision: record.capabilities?.vision === true,
  });
}

function isProvider(value: unknown): value is ModelProvider {
  return typeof value === "string" && value in PROVIDER_ENV;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
