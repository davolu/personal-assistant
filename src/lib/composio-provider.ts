import { Composio } from "@composio/core";
import type { ToolProvider } from "@/assistant/types";
import { loadCatalogTools, toolkitSlugFromTool, type ComposioListQuery, type ComposioToolSource, type RawComposioTool } from "@/assistant/composio-tools";
import { classifyEffect } from "@/assistant/policy";
import { toolkitOf, type CatalogAction } from "@/assistant/planning";

type RawList = { getRawComposioTools(query: { tools: string[] } | { toolkits: string[]; search?: string } | { search: string }): Promise<RawComposioTool[]> };

type SessionSearchPage = {
  results?: { primaryToolSlugs?: string[]; relatedToolSlugs?: string[]; toolkits?: string[] }[];
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
    const fromResult = result.toolkits?.find((toolkit) => toolkit.trim());
    for (const slug of [...(result.primaryToolSlugs ?? []), ...(result.relatedToolSlugs ?? [])]) {
      if (!slug || seen.has(slug) || slug.startsWith("COMPOSIO_") || slug.startsWith("builtin.")) continue;
      seen.add(slug);
      const schema = schemas[slug];
      const toolkit = (schema?.toolkit || fromResult || toolkitOf(slug)).toLowerCase();
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

type RawConnectedAccount = {
  id?: string;
  /** Owner id on the raw client. The SDK list transform drops this and exposes `wordId`, which is the account alias (`word_id`), not the user. */
  user_id?: string;
  status?: string;
  toolkit?: { slug?: string };
};

/**
 * Every ACTIVE connected account, following next_cursor.
 * Uses the raw client so `user_id` is still present.
 */
export async function listActiveConnections(composio: Composio, userId?: string): Promise<RawConnectedAccount[]> {
  const client = composio.getClient() as {
    connectedAccounts: {
      list: (query?: { statuses?: string[]; limit?: number; cursor?: string; user_ids?: string[] }) => Promise<{
        items?: RawConnectedAccount[];
        next_cursor?: string | null;
      }>;
    };
  };
  const found: RawConnectedAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const response = await client.connectedAccounts.list({
      statuses: ["ACTIVE"],
      limit: 100,
      cursor,
      ...(userId ? { user_ids: [userId] } : {}),
    });
    found.push(...(response.items ?? []).filter((item) => !item.status || item.status === "ACTIVE"));
    if (!response.next_cursor) break;
    cursor = response.next_cursor;
  }
  return found;
}

/** Toolkit slug to the ACTIVE connected-account id for this user. */
async function activeAccountsByToolkit(composio: Composio, userId: string): Promise<Map<string, string>> {
  const accounts = await listActiveConnections(composio, userId);
  const byToolkit = new Map<string, string>();
  for (const account of accounts) {
    if (account.user_id && account.user_id !== userId) continue;
    const toolkit = account.toolkit?.slug?.toLowerCase();
    if (toolkit && account.id && !byToolkit.has(toolkit)) byToolkit.set(toolkit, account.id);
  }
  return byToolkit;
}

/**
 * One Tool Router session, then `session.search` for each plain-language query.
 * That is Composio's semantic tool search (`COMPOSIO_SEARCH_TOOLS`): toolkits, actions, and connection status.
 * The session is pinned to the user's ACTIVE connected accounts, and connection status comes from that list.
 */
export async function searchSessionCatalog(composio: Composio, userId: string, queries: string[]): Promise<CatalogAction[]> {
  const active = await activeAccountsByToolkit(composio, userId).catch(() => null);
  const connectedAccounts = Object.fromEntries(active ?? []);
  const session = await composio.create(userId, {
    manageConnections: { enable: true },
    ...(Object.keys(connectedAccounts).length ? { connectedAccounts } : {}),
  });
  const asked = queries.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const pages = await Promise.all(
    asked.map((query) => session.search({ query: query.slice(0, 280) }).then((page) => page as SessionSearchPage).catch(() => null))
  );
  const found: CatalogAction[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!page) continue;
    for (const action of actionsFromSessionSearch(page)) {
      if (seen.has(action.slug)) continue;
      seen.add(action.slug);
      found.push(action);
    }
  }
  const slugs = [...new Set(found.map((action) => action.toolkit).filter((toolkit): toolkit is string => Boolean(toolkit)))];
  if (slugs.length) {
    try {
      const listed = await session.toolkits({ toolkits: slugs.slice(0, 25) });
      const names = new Map(listed.items.map((item) => [item.slug.toLowerCase(), item.name]));
      for (const action of found) {
        const name = action.toolkit ? names.get(action.toolkit) : undefined;
        if (name) action.toolkitName = name;
      }
    } catch {
      // The slug from the search response still identifies the toolkit.
    }
  }
  if (active) {
    for (const action of found) {
      if (!action.toolkit) continue;
      if (active.has(action.toolkit)) {
        action.connected = true;
        action.connectUrl = undefined;
      } else {
        action.connected = false;
      }
    }
  }
  const pending = [...new Set(found.filter((action) => action.connected === false && action.toolkit).map((action) => action.toolkit as string))].slice(0, 4);
  await Promise.all(
    pending.map(async (toolkit) => {
      try {
        const link = await session.authorize(toolkit);
        if (!link.redirectUrl) return;
        for (const action of found) if (action.toolkit === toolkit) action.connectUrl = link.redirectUrl;
      } catch {
        // The plan can still ask the host for a connect link.
      }
    })
  );
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
