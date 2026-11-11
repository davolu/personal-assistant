import { Composio } from "@composio/core";
import type { ToolProvider } from "@/assistant/types";
import { loadCatalogTools, toolkitSlugFromTool, type ComposioListQuery, type ComposioToolSource, type RawComposioTool } from "@/assistant/composio-tools";
import { classifyEffect } from "@/assistant/policy";
import { toolkitOf, type CatalogAction } from "@/assistant/planning";

type RawList = { getRawComposioTools(query: { tools: string[] } | { toolkits: string[]; search?: string } | { search: string }): Promise<RawComposioTool[]> };

type SessionSearchPage = {
  results?: { primaryToolSlugs?: string[]; relatedToolSlugs?: string[] }[];
  toolSchemas?: Record<string, { toolkit?: string; description?: string }>;
  toolkitConnectionStatuses?: { toolkit?: string; description?: string; hasActiveConnection?: boolean }[];
};

/** Keep Composio's order: primary tools, then related tools. Connection status comes from the same response. */
export function actionsFromSessionSearch(page: SessionSearchPage): CatalogAction[] {
  const status = new Map((page.toolkitConnectionStatuses ?? []).map((item) => [String(item.toolkit ?? "").toLowerCase(), item]));
  const schemas = page.toolSchemas ?? {};
  const actions: CatalogAction[] = [];
  const seen = new Set<string>();
  for (const result of page.results ?? []) {
    for (const slug of [...(result.primaryToolSlugs ?? []), ...(result.relatedToolSlugs ?? [])]) {
      if (!slug || seen.has(slug) || slug.startsWith("COMPOSIO_") || slug.startsWith("builtin.")) continue;
      seen.add(slug);
      const schema = schemas[slug];
      const toolkit = (schema?.toolkit || toolkitOf(slug)).toLowerCase();
      const connection = status.get(toolkit);
      actions.push({
        slug,
        description: schema?.description,
        toolkit,
        connected: connection?.hasActiveConnection ?? false,
      });
    }
  }
  return actions;
}

/**
 * One Tool Router session, then `session.search` for each plain-language query.
 * That is Composio's semantic tool search (`COMPOSIO_SEARCH_TOOLS`): toolkits, actions, and connection status.
 */
export async function searchSessionCatalog(composio: Composio, userId: string, queries: string[]): Promise<CatalogAction[]> {
  const session = await composio.create(userId, { manageConnections: true });
  const found: CatalogAction[] = [];
  const seen = new Set<string>();
  for (const query of queries.map((item) => item.trim()).filter(Boolean).slice(0, 3)) {
    const page = (await session.search({ query: query.slice(0, 280) })) as SessionSearchPage;
    for (const action of actionsFromSessionSearch(page)) {
      if (seen.has(action.slug)) continue;
      seen.add(action.slug);
      found.push(action);
    }
  }
  return found;
}

/** The SDK overloads reject a bag of optional fields, so pick one legal query shape. */
export async function listComposioRaw(tools: RawList, query: ComposioListQuery): Promise<RawComposioTool[]> {
  if (query.tools && query.tools.length > 0) return tools.getRawComposioTools({ tools: query.tools });
  if (query.toolkits && query.toolkits.length > 0 && query.search) {
    return tools.getRawComposioTools({ toolkits: query.toolkits, search: query.search });
  }
  if (query.toolkits && query.toolkits.length > 0) return tools.getRawComposioTools({ toolkits: query.toolkits });
  if (query.search) return tools.getRawComposioTools({ search: query.search });
  return [];
}

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
      return listComposioRaw(client().tools, query);
    },
  };
}

/**
 * Searches the Composio catalog for any toolkit, always offers no-auth web search,
 * and refuses to run an app tool until that user has connected the toolkit.
 * Sends stay external and are held by the gate.
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
      if (!options?.source) {
        const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
        const actions = await searchSessionCatalog(client, userId, [query]).catch(() => [] as CatalogAction[]);
        return actions.map((action) => ({
          name: action.slug,
          description: action.description ?? "",
          inputSchema: {},
          effect: classifyEffect(action.slug),
          provider: "composio" as const,
        }));
      }
      const slugs = await slugsForUser(userId).catch(() => [] as string[]);
      return loadCatalogTools(query, slugs, source);
    },
    async call(userId, name, args) {
      const toolkit = toolkitSlugFromTool(name);
      if (toolkit) {
        const slugs = (await slugsForUser(userId).catch(() => [] as string[])).map((slug) => slug.toLowerCase());
        if (!slugs.includes(toolkit)) {
          return { ok: false, error: { code: "NOT_CONNECTED", message: toolkit } };
        }
      }
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
