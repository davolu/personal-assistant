export type ModelCapabilities = {
  tools: boolean;
  thinking: boolean;
  computer: boolean;
  promptCache: boolean;
};

export type ModelProvider = "anthropic" | "openai" | "google" | "xai" | "mistral" | "deepseek" | "groq" | "openrouter";

export type RegistryModel = {
  id: string;
  provider: ModelProvider;
  label: string;
  /** Provider model slug. Claude Sonnet uses ANTHROPIC_MODEL when that env var is set. */
  model: string;
  /** Name of the API key env var. The value is never sent to the browser. */
  env: string;
  capabilities: ModelCapabilities;
};

export type PublicModel = {
  id: string;
  provider: ModelProvider;
  label: string;
  model: string;
  env: string;
  available: boolean;
  capabilities: ModelCapabilities;
};

export const CLAUDE_MODEL_ID = "claude-sonnet";

const tools = true;

export const MODEL_REGISTRY: readonly RegistryModel[] = [
  {
    id: CLAUDE_MODEL_ID,
    provider: "anthropic",
    label: "Claude Sonnet",
    model: "claude-sonnet-4-5",
    env: "ANTHROPIC_API_KEY",
    capabilities: { tools, thinking: true, computer: true, promptCache: true },
  },
  {
    id: "claude-haiku",
    provider: "anthropic",
    label: "Claude Haiku",
    model: "claude-haiku-4-5",
    env: "ANTHROPIC_API_KEY",
    capabilities: { tools, thinking: true, computer: false, promptCache: true },
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    model: "gpt-4.1",
    env: "OPENAI_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "openai-computer",
    provider: "openai",
    label: "OpenAI computer use",
    model: "computer-use-preview",
    env: "OPENAI_API_KEY",
    capabilities: { tools, thinking: false, computer: true, promptCache: false },
  },
  {
    id: "gemini-flash",
    provider: "google",
    label: "Gemini Flash",
    model: "gemini-2.5-flash",
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "gemini-pro",
    provider: "google",
    label: "Gemini Pro",
    model: "gemini-2.5-pro",
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
    capabilities: { tools, thinking: true, computer: false, promptCache: false },
  },
  {
    id: "grok",
    provider: "xai",
    label: "Grok",
    model: "grok-3",
    env: "XAI_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "mistral-large",
    provider: "mistral",
    label: "Mistral Large",
    model: "mistral-large-latest",
    env: "MISTRAL_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "deepseek",
    provider: "deepseek",
    label: "DeepSeek",
    model: "deepseek-chat",
    env: "DEEPSEEK_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "groq-llama",
    provider: "groq",
    label: "Groq Llama",
    model: "llama-3.3-70b-versatile",
    env: "GROQ_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
  {
    id: "openrouter",
    provider: "openrouter",
    label: "OpenRouter",
    model: "openai/gpt-4.1",
    env: "OPENROUTER_API_KEY",
    capabilities: { tools, thinking: false, computer: false, promptCache: false },
  },
];

export function listModels(env: Record<string, string | undefined> = process.env): PublicModel[] {
  return MODEL_REGISTRY.map((model) => ({
    id: model.id,
    provider: model.provider,
    label: model.label,
    model: runtimeModel(model, env),
    env: model.env,
    available: hasKey(env, model.env),
    capabilities: model.capabilities,
  }));
}

export function defaultModelId(env: Record<string, string | undefined> = process.env): string | null {
  const models = listModels(env);
  const claude = models.find((model) => model.id === CLAUDE_MODEL_ID && model.available);
  if (claude) return claude.id;
  return models.find((model) => model.available)?.id ?? null;
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

export function runtimeModel(model: RegistryModel, env: Record<string, string | undefined>): string {
  if (model.id === CLAUDE_MODEL_ID) return env.ANTHROPIC_MODEL?.trim() || env.ANTHROPIC_MODEL_STRONG?.trim() || model.model;
  if (model.id === "claude-haiku") return env.ANTHROPIC_MODEL_CHEAP?.trim() || model.model;
  return model.model;
}
