import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage } from "ai";
import { usageFromUnknown } from "@/lib/credits";
import type { ClaudeDriver, ClaudeTurn } from "./claude";
import { providerOptionsFor, resolveModel, type PublicModel } from "./models";
import type { AgenticMessage, ContentBlock, ToolUseBlock } from "./types";

type GenerateResult = {
  text?: string;
  reasoningText?: string;
  usage?: unknown;
  toolCalls?: { toolCallId: string; toolName: string; input: unknown }[];
};

type GenerateFn = (options: {
  model: unknown;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, unknown>;
  stopWhen: unknown;
  providerOptions?: Record<string, Record<string, unknown>>;
}) => Promise<GenerateResult>;

type SchemaTool = { name: string; description?: string; input_schema?: unknown };

export function createAgentDriver(opts?: {
  env?: Record<string, string | undefined>;
  generate?: GenerateFn;
  languageModel?: (model: PublicModel) => Promise<unknown> | unknown;
}): ClaudeDriver {
  const env = opts?.env ?? process.env;
  const generate = opts?.generate ?? (generateText as unknown as GenerateFn);
  return {
    async complete({ system, messages, tools, modelId }) {
      const resolved = resolveModel(modelId, env);
      if (!resolved.ok) throw new Error(resolved.error);
      const model = resolved.model;
      const language = opts?.languageModel ? await opts.languageModel(model) : await languageModelFor(model);
      const aiTools = toAiTools(tools as readonly SchemaTool[]);
      const providerOptions = providerOptionsFor(model);
      try {
        return fromGenerate(
          await generate({
            model: language,
            system,
            messages: toAiMessages(messages, true),
            tools: aiTools,
            stopWhen: stepCountIs(1),
            providerOptions,
          })
        );
      } catch (err) {
        if (!providerOptions || !isProviderOptionRejected(err)) throw err;
        return fromGenerate(
          await generate({
            model: language,
            system,
            messages: toAiMessages(messages, false),
            tools: aiTools,
            stopWhen: stepCountIs(1),
          })
        );
      }
    },
  };
}

async function languageModelFor(model: PublicModel): Promise<unknown> {
  switch (model.provider) {
    case "anthropic": {
      const { anthropic } = await import("@ai-sdk/anthropic");
      return anthropic(model.model);
    }
    case "openai": {
      const { openai } = await import("@ai-sdk/openai");
      return openai(model.model);
    }
    case "google": {
      const { google } = await import("@ai-sdk/google");
      return google(model.model);
    }
    case "xai": {
      const { xai } = await import("@ai-sdk/xai");
      return xai(model.model);
    }
    case "mistral": {
      const { mistral } = await import("@ai-sdk/mistral");
      return mistral(model.model);
    }
    case "deepseek": {
      const { deepseek } = await import("@ai-sdk/deepseek");
      return deepseek(model.model);
    }
    case "groq": {
      const { groq } = await import("@ai-sdk/groq");
      return groq(model.model);
    }
    case "openrouter": {
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      return openrouter(model.model);
    }
    default:
      throw new Error(`No provider for ${model.provider}.`);
  }
}

function toAiTools(schemas: readonly SchemaTool[]): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  for (const schema of schemas) {
    const input = schema.input_schema && typeof schema.input_schema === "object" ? schema.input_schema : { type: "object", properties: {} };
    tools[schema.name] = tool({
      description: schema.description ?? schema.name,
      inputSchema: jsonSchema(input as Parameters<typeof jsonSchema>[0]),
    });
  }
  return tools;
}

export function toAiMessages(messages: AgenticMessage[], keepReasoning: boolean): ModelMessage[] {
  const converted: ModelMessage[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      converted.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const content: Extract<ModelMessage, { role: "assistant" }>["content"] = [];
      for (const block of message.content) {
        if (block.type === "text" && block.text) content.push({ type: "text", text: block.text });
        else if (block.type === "thinking" && keepReasoning && block.thinking) content.push({ type: "reasoning", text: block.thinking });
        else if (block.type === "tool_use") content.push({ type: "tool-call", toolCallId: block.id, toolName: block.name, input: block.input });
      }
      if (content.length) converted.push({ role: "assistant", content });
      continue;
    }
    const results: Extract<ModelMessage, { role: "tool" }>["content"] = [];
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === "tool_result") {
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        results.push({ type: "tool-result", toolCallId: block.tool_use_id, toolName: toolNameFor(messages, block.tool_use_id), output: { type: "text", value: text } });
      } else if (block.type === "text" && block.text) texts.push(block.text);
    }
    if (results.length) converted.push({ role: "tool", content: results });
    if (texts.length) converted.push({ role: "user", content: texts.join("\n") });
  }
  return converted;
}

function toolNameFor(messages: AgenticMessage[], toolCallId: string): string {
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use" && block.id === toolCallId) return block.name;
    }
  }
  return "tool";
}

function fromGenerate(result: GenerateResult): ClaudeTurn {
  const content: ContentBlock[] = [];
  const reasoning = result.reasoningText?.replace(/\s+/g, " ").trim() ?? "";
  if (reasoning) content.push({ type: "thinking", thinking: reasoning });
  if (result.text?.trim()) content.push({ type: "text", text: result.text });
  for (const call of result.toolCalls ?? []) {
    const input = call.input && typeof call.input === "object" ? (call.input as Record<string, unknown>) : {};
    const use: ToolUseBlock = { type: "tool_use", id: call.toolCallId, name: call.toolName, input };
    content.push(use);
  }
  if (!content.length) content.push({ type: "text", text: "" });
  const usage = usageFromUnknown(result.usage)?.usage;
  return { content, thinkingSummary: reasoning.slice(0, 240), ...(usage ? { usage } : {}) };
}

function isProviderOptionRejected(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /thinking|cache|between_tools|budget_tokens/i.test(message);
}
