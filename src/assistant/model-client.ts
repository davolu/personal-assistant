import type { ChatMessage, ModelClient, ModelResponse } from "./types";
import { FALLBACK_STATUSES, routeRole, type RouterEnv } from "./router";

export class ModelUnavailableError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelUnavailableError";
    this.status = status;
  }
}

type Env = Record<string, string | undefined>;

function routerEnv(env: Env): RouterEnv {
  return {
    strongModel: env.ANTHROPIC_MODEL_STRONG,
    cheapModel: env.ANTHROPIC_MODEL_CHEAP,
    fallbackModel: env.OPENAI_MODEL_FALLBACK,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    hasAnthropic: Boolean(env.ANTHROPIC_API_KEY),
    hasOpenAI: Boolean(env.OPENAI_API_KEY),
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

function anthropicHeaders(env: Env): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
  };
}

function supportsThinking(model: string): boolean {
  return /sonnet|opus|3-7|claude-4/i.test(model) && !/haiku/i.test(model);
}

async function anthropicStream(
  env: Env,
  fetchImpl: typeof fetch,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  onThinking: (text: string) => void
): Promise<ModelResponse> {
  const budget = 512;
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(env),
    body: JSON.stringify({
      model,
      max_tokens: Math.max(maxTokens, budget + 256),
      thinking: { type: "enabled", budget_tokens: budget },
      stream: true,
      system,
      messages,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) throw new ModelUnavailableError(await readError(res), res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: { type?: string; delta?: { type?: string; thinking?: string; text?: string }; message?: { usage?: { input_tokens?: number } }; usage?: { output_tokens?: number } };
      try {
        event = JSON.parse(payload) as typeof event;
      } catch {
        continue;
      }
      if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
      if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? outputTokens;
      if (event.delta?.type === "thinking_delta" && event.delta.thinking) onThinking(event.delta.thinking);
      if (event.delta?.type === "text_delta" && event.delta.text) text += event.delta.text;
    }
  }
  return { text, inputTokens, outputTokens, model, provider: "anthropic" };
}

async function anthropicChat(
  env: Env,
  fetchImpl: typeof fetch,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  onThinking?: (text: string) => void,
  temperature?: number
): Promise<ModelResponse> {
  if (onThinking && temperature === undefined && supportsThinking(model)) {
    try {
      return await anthropicStream(env, fetchImpl, model, system, messages, maxTokens, onThinking);
    } catch (err) {
      const status = err instanceof ModelUnavailableError ? err.status : undefined;
      if (status !== undefined && status !== 400 && status !== 404) throw err;
    }
  }
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(env),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ModelUnavailableError(await readError(res), res.status);
  const json = (await res.json()) as { content?: { type?: string; text?: string; thinking?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  for (const block of json.content ?? []) {
    if (block.type === "thinking" && block.thinking && onThinking) onThinking(block.thinking);
  }
  const text = json.content?.map((block) => block.text ?? "").join("") ?? "";
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    model,
    provider: "anthropic",
  };
}

async function openaiChat(
  env: Env,
  fetchImpl: typeof fetch,
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature?: number
): Promise<ModelResponse> {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new ModelUnavailableError(await readError(res), res.status);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    model,
    provider: "openai",
  };
}

export function createModelClient(opts?: { fetchImpl?: typeof fetch; env?: Env }): ModelClient {
  const env = opts?.env ?? process.env;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  return {
    async complete(req) {
      const choice = routeRole(req.role, routerEnv(env));
      const maxTokens = req.maxTokens ?? 1024;
      if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
        throw new ModelUnavailableError("Set ANTHROPIC_API_KEY. Claude is the assistant's model.");
      }
      if (choice.provider === "openai" || !env.ANTHROPIC_API_KEY) {
        return openaiChat(env, fetchImpl, env.OPENAI_MODEL_FALLBACK || choice.model, req.system, req.messages, maxTokens, req.temperature);
      }
      try {
        return await anthropicChat(env, fetchImpl, choice.model, req.system, req.messages, maxTokens, req.onThinking, req.temperature);
      } catch (err) {
        const status = err instanceof ModelUnavailableError ? err.status : undefined;
        const timedOut = err instanceof Error && /timeout|aborted/i.test(err.message);
        if (env.OPENAI_API_KEY && (timedOut || (status !== undefined && FALLBACK_STATUSES.has(status)))) {
          return openaiChat(env, fetchImpl, env.OPENAI_MODEL_FALLBACK || "gpt-4o-mini", req.system, req.messages, maxTokens, req.temperature);
        }
        if (err instanceof ModelUnavailableError) throw err;
        throw new ModelUnavailableError(err instanceof Error ? err.message : "model failed");
      }
    },
  };
}

export async function embedText(text: string, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  if (!env.OPENAI_API_KEY) return null;
  const res = await fetchImpl("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small", input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  return json.data?.[0]?.embedding ?? null;
}
