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

async function anthropicChat(env: Env, fetchImpl: typeof fetch, model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<ModelResponse> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ModelUnavailableError(await readError(res), res.status);
  const json = (await res.json()) as { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = json.content?.map((block) => block.text ?? "").join("") ?? "";
  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    model,
    provider: "anthropic",
  };
}

async function openaiChat(env: Env, fetchImpl: typeof fetch, model: string, system: string, messages: ChatMessage[], maxTokens: number): Promise<ModelResponse> {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...messages],
    }),
    signal: AbortSignal.timeout(30_000),
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
        return openaiChat(env, fetchImpl, env.OPENAI_MODEL_FALLBACK || choice.model, req.system, req.messages, maxTokens);
      }
      try {
        return await anthropicChat(env, fetchImpl, choice.model, req.system, req.messages, maxTokens);
      } catch (err) {
        const status = err instanceof ModelUnavailableError ? err.status : undefined;
        const timedOut = err instanceof Error && /timeout|aborted/i.test(err.message);
        if (env.OPENAI_API_KEY && (timedOut || (status !== undefined && FALLBACK_STATUSES.has(status)))) {
          return openaiChat(env, fetchImpl, env.OPENAI_MODEL_FALLBACK || "gpt-4o-mini", req.system, req.messages, maxTokens);
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
