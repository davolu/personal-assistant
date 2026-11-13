import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@/lib/credits";
import { usageFromUnknown } from "@/lib/credits";
import { computerToolForModel } from "./computer";
import type { AgenticMessage, ContentBlock, ThinkingBlock, ToolUseBlock } from "./types";

export type ClaudeTurn = {
  content: ContentBlock[];
  thinkingSummary: string;
  usage?: TokenUsage;
};

export interface ClaudeDriver {
  complete(input: { system: string; messages: AgenticMessage[]; tools: readonly Record<string, unknown>[]; modelId?: string }): Promise<ClaudeTurn>;
}

export function agentModel(env: Record<string, string | undefined> = process.env): string {
  return env.ANTHROPIC_MODEL || env.ANTHROPIC_MODEL_STRONG || "claude-sonnet-4-5";
}

export function createClaudeDriver(opts?: {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): ClaudeDriver {
  const env = opts?.env ?? process.env;
  const model = agentModel(env);
  return {
    async complete({ system, messages, tools: toolsIn }) {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("Set ANTHROPIC_API_KEY to use this model.");
      }
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: opts?.fetchImpl });
      const tools = [...toolsIn];
      const payload = { model, max_tokens: 8192, system, tools, messages: toAnthropic(messages), stream: false as const };
      try {
        const response = await client.messages.create({ ...payload, thinking: { type: "between_tools" } } as unknown as Anthropic.MessageCreateParamsNonStreaming);
        return fromAnthropic(response);
      } catch (err) {
        if (!isThinkingRejected(err)) throw err;
        const response = await client.messages.create({
          ...payload,
          thinking: { type: "enabled", budget_tokens: 2048 },
        } as unknown as Anthropic.MessageCreateParamsNonStreaming);
        return fromAnthropic(response);
      }
    },
  };
}

export function createComputerModel(env: Record<string, string | undefined> = process.env) {
  const model = agentModel(env);
  const spec = computerToolForModel(model);
  return {
    spec,
    async complete(input: { system: string; messages: AgenticMessage[] }) {
      if (!env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const params = {
        model,
        max_tokens: 4096,
        system: input.system,
        tools: spec.tools,
        messages: toAnthropic(input.messages),
        stream: false as const,
      };
      const response = spec.betas.length
        ? await client.beta.messages.create({ ...params, betas: spec.betas } as never)
        : await client.messages.create(params as unknown as Anthropic.MessageCreateParamsNonStreaming);
      return fromAnthropic(response as Anthropic.Message);
    },
  };
}

function isThinkingRejected(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /thinking|between_tools|budget_tokens/i.test(message);
}

function toAnthropic(messages: AgenticMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string" ? message.content : (message.content.filter(keepBlock) as Anthropic.MessageParam["content"]),
  }));
}

function keepBlock(block: ContentBlock): boolean {
  if (block.type === "thinking") return Boolean(block.signature);
  return block.type === "text" || block.type === "tool_use" || block.type === "tool_result" || block.type === "image";
}

function fromAnthropic(response: { content: Anthropic.ContentBlock[]; usage?: unknown }): ClaudeTurn {
  const content: ContentBlock[] = [];
  const thoughts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "thinking") {
      const thinking = block as { type: "thinking"; thinking: string; signature?: string };
      thoughts.push(thinking.thinking);
      const stored: ThinkingBlock = { type: "thinking", thinking: thinking.thinking, signature: thinking.signature };
      content.push(stored);
    } else if (block.type === "tool_use") {
      const tool = block as { type: "tool_use"; id: string; name: string; input: unknown };
      const input = tool.input && typeof tool.input === "object" ? (tool.input as Record<string, unknown>) : {};
      const use: ToolUseBlock = { type: "tool_use", id: tool.id, name: tool.name, input };
      content.push(use);
    }
  }
  const thinkingSummary = thoughts.join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
  const usage = usageFromUnknown(response.usage)?.usage;
  return { content, thinkingSummary, ...(usage ? { usage } : {}) };
}
