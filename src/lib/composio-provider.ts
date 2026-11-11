import { Composio } from "@composio/core";
import type { ToolProvider } from "@/assistant/types";
import { loadCatalogTools, toolkitSlugFromTool, type ComposioListQuery, type ComposioToolSource, type RawComposioTool } from "@/assistant/composio-tools";

type RawList = { getRawComposioTools(query: { tools: string[] } | { toolkits: string[]; search?: string } | { search: string }): Promise<RawComposioTool[]> };

type ToolPage = { items?: { slug?: string; name?: string; description?: string }[]; next_cursor?: string | null };

/** Every action in a toolkit, following cursors. Important-only pages hide generate actions. */
export async function listAllToolkitActions(composio: Composio, slug: string): Promise<{ slug: string; description?: string }[]> {
  const list = composio.getClient().tools.list.bind(composio.getClient().tools) as (query: {
    toolkit_slug: string;
    limit: number;
    cursor?: string;
  }) => Promise<ToolPage>;
  const found: { slug: string; description?: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 8; page++) {
    const response = await list({ toolkit_slug: slug, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const item of response.items ?? []) {
      const name = item.slug ?? item.name ?? "";
      if (name) found.push({ slug: name, description: item.description });
    }
    if (!response.next_cursor) break;
    cursor = response.next_cursor;
  }
  return found;
}

const SEARCH_STOP = new Set(["the", "a", "an", "to", "for", "my", "me", "and", "of", "on", "in", "with", "into", "your", "you", "this", "that", "from", "about", "get", "make", "post", "latest", "all", "can", "please"]);

function nameTokens(phrases: string[]): string[] {
  const names = new Set<string>();
  for (const phrase of phrases) {
    for (const token of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 2 && !SEARCH_STOP.has(token)) names.add(token);
    }
  }
  return [...names].slice(0, 8);
}

/** Toolkit-name search plus semantic action search. Phrases are split into words because the toolkit index misses long phrases. */
export async function searchComposioCatalog(
  composio: Composio,
  spec: { toolkits?: string[]; capabilities?: string[]; queries?: string[] }
): Promise<{ slug: string; description?: string; toolkit?: string }[]> {
  const names = nameTokens([...(spec.toolkits ?? []), ...(spec.capabilities ?? []), ...(spec.queries ?? [])]);
  const phrases = [...(spec.capabilities ?? []), ...(spec.queries ?? []).filter((query) => query.includes(" "))].slice(0, 3);
  const toolkitSlugs = new Set<string>();
  const listToolkits = composio.getClient().toolkits.list.bind(composio.getClient().toolkits) as (query: {
    search: string;
    limit: number;
  }) => Promise<{ slug?: string; items?: { slug?: string }[] } | { slug?: string }[]>;
  for (const name of names) {
    try {
      const page = await listToolkits({ search: name, limit: 5 });
      const items = Array.isArray(page) ? page : page.items ?? [];
      for (const item of items) if (item.slug) toolkitSlugs.add(item.slug);
    } catch {
      // The next token can still match.
    }
  }
  const collected: { slug: string; description?: string; toolkit?: string }[] = [];
  for (const slug of [...toolkitSlugs].slice(0, 6)) {
    const actions = await listAllToolkitActions(composio, slug).catch(() => []);
    collected.push(...actions.map((action) => ({ ...action, toolkit: toolkitSlugFromTool(action.slug) ?? slug })));
  }
  for (const phrase of phrases) {
    const raw = await listComposioRaw(composio.tools, { search: phrase.slice(0, 80) }).catch(() => []);
    for (const tool of raw) {
      const slug = tool.slug ?? tool.name ?? "";
      if (slug) collected.push({ slug, description: tool.description, toolkit: toolkitSlugFromTool(slug) ?? undefined });
    }
  }
  const seen = new Set<string>();
  return collected.filter((action) => (seen.has(action.slug) ? false : (seen.add(action.slug), true)));
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
