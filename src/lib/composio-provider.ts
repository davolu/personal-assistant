import { Composio } from "@composio/core";
import type { ToolProvider } from "@/assistant/types";
import { loadConnectedToolkitTools, type ComposioToolSource, type RawComposioTool } from "@/assistant/composio-tools";

async function defaultSlugs(userId: string): Promise<string[]> {
  const { prisma } = await import("@/lib/prisma");
  const { toolkitComposioSlug } = await import("@/lib/toolkits");
  const rows = await prisma.connection.findMany({
    where: { userId, status: "active" },
    select: { toolkit: true },
  });
  return rows.map((row) => toolkitComposioSlug(row.toolkit));
}

function sdkSource(): ComposioToolSource {
  const client = () => new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  return {
    async listRaw(query) {
      const tools = await client().tools.getRawComposioTools(query);
      return tools as RawComposioTool[];
    },
  };
}

/**
 * Lists Composio actions for toolkits this user has connected, then executes
 * them with that same user id. Sends stay external and are held by the gate.
 */
export function createComposioProvider(options?: {
  slugsForUser?: (userId: string) => Promise<string[]>;
  source?: ComposioToolSource;
}): ToolProvider {
  const slugsForUser = options?.slugsForUser ?? defaultSlugs;
  const source = options?.source ?? sdkSource();
  return {
    id: "composio",
    handles: (name) => !name.startsWith("builtin.") && !name.startsWith("mcp."),
    async list(userId, query) {
      if (!options?.source && !process.env.COMPOSIO_API_KEY) return [];
      const slugs = await slugsForUser(userId);
      if (slugs.length === 0) return [];
      return loadConnectedToolkitTools(slugs, query, source);
    },
    async call(userId, name, args) {
      const { idempotencyKey: _ignored, ...rest } = args;
      const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
      const result = (await client.tools.execute(
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
