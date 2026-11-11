import { Composio } from "@composio/core";
import type { ToolProvider, ToolSpec } from "@/assistant/types";
import { classifyEffect } from "@/assistant/policy";

function normalize(tools: unknown[]): ToolSpec[] {
  return tools
    .map((tool) => {
      const row = tool as {
        name?: string;
        slug?: string;
        description?: string;
        function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
        inputSchema?: Record<string, unknown>;
      };
      const name = row.function?.name ?? row.slug ?? row.name ?? "";
      return {
        name,
        description: row.function?.description ?? row.description ?? "",
        inputSchema: row.function?.parameters ?? row.inputSchema ?? {},
        effect: classifyEffect(name),
        provider: "composio" as const,
      };
    })
    .filter((tool) => tool.name);
}

/** Composio is the long-tail provider. Managed OAuth stays in Composio; we do not copy those tokens. */
export function createComposioProvider(): ToolProvider {
  const client = () => new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return {
    id: "composio",
    handles: (name) => !name.startsWith("builtin.") && !name.startsWith("mcp."),
    async list(userId, query) {
      if (!process.env.COMPOSIO_API_KEY || !query.trim()) return [];
      const tools = await client().tools.get(userId, { search: query.slice(0, 80) });
      const list = Array.isArray(tools) ? tools : Array.from(tools as Iterable<unknown>);
      return normalize(list).slice(0, 12);
    },
    async call(userId, name, args) {
      const { idempotencyKey: _ignored, ...rest } = args;
      const result = (await client().tools.execute(
        name,
        { userId, arguments: rest, dangerouslySkipVersionCheck: true },
        { signal: AbortSignal.timeout(15_000) }
      )) as { successful?: boolean; data?: unknown; error?: unknown };
      const failed = result.successful === false || Boolean(result.error);
      if (failed) {
        return { ok: false, error: { code: "TOOL_FAILED", message: String(result.error ?? "Composio call failed").slice(0, 300) } };
      }
      return { ok: true, data: result.data ?? result };
    },
  };
}
