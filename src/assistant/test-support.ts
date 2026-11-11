import type { ChatMessage, ModelClient, ModelRequest, ModelResponse, ToolProvider, ToolSpec } from "./types";
import type { TurnInput } from "./orchestrator";

export class ScriptedModel implements ModelClient {
  seen: ModelRequest[] = [];
  constructor(private respond: (req: ModelRequest, index: number) => string) {}
  async complete(req: ModelRequest): Promise<ModelResponse> {
    const index = this.seen.length;
    this.seen.push(req);
    return {
      text: this.respond(req, index),
      inputTokens: 20,
      outputTokens: 20,
      model: "claude-sonnet-4-5",
      provider: "anthropic",
    };
  }
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function recordingProvider(tools: ToolSpec[]): { provider: ToolProvider; calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    provider: {
      id: "composio",
      async list() {
        return tools;
      },
      async call(_userId, name, args) {
        calls.push({ name, args });
        return { ok: true, data: { echoed: args } };
      },
    },
  };
}

export function baseTurn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    userId: "user-a",
    conversationId: "c1",
    taskId: "t1",
    text: "hello",
    trigger: "chat",
    history: [],
    facts: [],
    episodes: [],
    chunks: [],
    connections: [],
    quota: { dailySpendUsd: 0, dailyLimitUsd: 5, recentTurns: 0, recentLimit: 20 },
    ...overrides,
  };
}

export function promptText(seen: ModelRequest[]): string {
  return seen.map((req) => `${req.system}\n${req.messages.map((m: ChatMessage) => m.content).join("\n")}`).join("\n");
}
