import type { ToolSpec } from "./types";
import { classifyEffect } from "./policy";

export type RawComposioTool = {
  slug?: string;
  name?: string;
  description?: string;
  inputParameters?: Record<string, unknown>;
  function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
};

export type ComposioListQuery = { toolkits?: string[]; tools?: string[]; search?: string };

export type ComposioToolSource = {
  listRaw(query: ComposioListQuery): Promise<RawComposioTool[]>;
};

/** No user OAuth. The host calls this directly from builtin.web.search. */
export const WEB_SEARCH_TOOL = "COMPOSIO_SEARCH_WEB";

const QUERY_STOP = new Set([
  "send", "email", "emails", "mail", "message", "messages", "search", "web", "the", "latest", "for", "and", "my", "to",
  "a", "an", "once", "day", "daily", "create", "draft", "get", "find", "read", "list", "of", "in", "on", "with",
  "please", "me", "you", "your", "from", "this", "that", "new", "using", "use", "app", "apps", "tool", "tools",
  "into", "onto", "via", "per", "every", "each", "morning", "hour", "hourly", "week", "weekly", "user", "account",
]);

export function toolkitSlugFromTool(name: string): string | null {
  if (name.startsWith("COMPOSIO_") || name.startsWith("builtin.") || name.startsWith("mcp.")) return null;
  const head = name.split("_")[0]?.toLowerCase();
  return head || null;
}

/** OpenAI-wrapped tools and raw Composio tools both become the hub's tool specs. */
export function composioToolsFromRaw(tools: RawComposioTool[]): ToolSpec[] {
  const specs: ToolSpec[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    const name = tool.function?.name ?? tool.slug ?? tool.name ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    specs.push({
      name,
      description: tool.function?.description ?? tool.description ?? "",
      inputSchema: tool.function?.parameters ?? tool.inputParameters ?? {},
      effect: classifyEffect(name),
      provider: "composio",
    });
  }
  return specs;
}

/** Tokens that name a toolkit, plus adjacent pairs such as zoho_crm. */
export function toolkitCandidates(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !QUERY_STOP.has(token));
  const slugs: string[] = [];
  const seen = new Set<string>();
  const add = (slug: string) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    slugs.push(slug);
  };
  for (const token of tokens) add(token);
  for (let i = 0; i < tokens.length - 1; i++) add(`${tokens[i]}_${tokens[i + 1]}`);
  return slugs.slice(0, 4);
}

/**
 * Prefer the toolkit the user named, then connected toolkits, then send and draft actions.
 * Web search is a builtin and is not mixed into these hits.
 */
export function rankCatalogTools(query: string, tools: ToolSpec[], connectedSlugs: string[]): ToolSpec[] {
  const connected = new Set(connectedSlugs.map((slug) => slug.toLowerCase()));
  const named = toolkitCandidates(query);
  const namedSet = new Set(named);
  const primary = named[0] ?? "";
  const wantsReadMail = /\b(unread|inbox|latest|fetch|read|list)\b/i.test(query) && /\b(email|mail|gmail)\b/i.test(query);
  const wantsSend = !wantsReadMail && /\b(send|email|mail)\b/i.test(query);
  const indexed = tools
    .filter((tool) => !tool.name.startsWith("COMPOSIO_") && !tool.name.startsWith("builtin."))
    .map((tool, index) => {
      const slug = toolkitSlugFromTool(tool.name) ?? "";
      let score = 0;
      if (slug && namedSet.has(slug)) score += 100;
      if (slug && named.some((item) => item === slug || item.startsWith(`${slug}_`) || slug.startsWith(item))) score += 20;
      if (slug && slug === primary) score += 15;
      if (slug && connected.has(slug)) score += 50;
      if (wantsReadMail && /FETCH_EMAILS|LIST_EMAILS|FETCH_MESSAGE|LIST_THREADS|LIST_EMAIL/.test(tool.name)) score += 40;
      if (wantsReadMail && /SEND_|CREATE_EMAIL_DRAFT|DRAFT/.test(tool.name)) score -= 25;
      if (wantsSend && /SEND_(EMAIL|MAIL)/.test(tool.name)) score += 30;
      else if (wantsSend && /CREATE_EMAIL_DRAFT/.test(tool.name)) score += 28;
      else if (wantsSend && /DRAFT/.test(tool.name)) score += 10;
      return { tool, score, index };
    });
  const hasNamed = indexed.some((item) => item.score >= 100);
  const pool = hasNamed ? indexed.filter((item) => item.score >= 100) : indexed;
  pool.sort((a, b) => b.score - a.score || a.index - b.index);
  const seen = new Set<string>();
  const ranked: ToolSpec[] = [];
  for (const item of pool) {
    if (seen.has(item.tool.name)) continue;
    seen.add(item.tool.name);
    ranked.push(item.tool);
  }
  return ranked.slice(0, 20);
}

/**
 * Search the Composio catalog. A named toolkit (gmail, zoho, notion) is filtered
 * on the API, then ranked ahead of lookalike tools from other apps.
 */
export async function loadCatalogTools(
  query: string,
  connectedSlugs: string[],
  source: ComposioToolSource
): Promise<ToolSpec[]> {
  const trimmed = query.trim().slice(0, 80);
  const named = toolkitCandidates(trimmed);
  const [global, scoped, connected] = await Promise.all([
    trimmed ? source.listRaw({ search: trimmed }).catch(() => [] as RawComposioTool[]) : Promise.resolve([] as RawComposioTool[]),
    Promise.all(
      named.map(async (slug) => {
        const [important, searched] = await Promise.all([
          source.listRaw({ toolkits: [slug] }).catch(() => [] as RawComposioTool[]),
          trimmed ? source.listRaw({ toolkits: [slug], search: trimmed }).catch(() => [] as RawComposioTool[]) : Promise.resolve([] as RawComposioTool[]),
        ]);
        return [...important, ...searched];
      })
    ),
    loadConnectedToolkitTools(connectedSlugs, trimmed, source),
  ]);
  const specs = [...composioToolsFromRaw(scoped.flat()), ...connected, ...composioToolsFromRaw(global)];
  return rankCatalogTools(trimmed, specs, connectedSlugs);
}

/** Web search is for facts the user asked about, not for discovering apps. */
export function wantsFactualWebSearch(text: string): boolean {
  if (/\b(find|search)\b/i.test(text) && /\btools?\b/i.test(text)) return false;
  if (/\b(api|toolkit|composio|zapier)\b/i.test(text)) return false;
  return /\b(search|look up|latest|news|grants|nonprofit)\b/i.test(text);
}

export function mentionsAppData(text: string): boolean {
  return /\b(canva|canvas|notion|gmail|slack|outlook|calendar)\b/i.test(text);
}

export function ensureSearchTools(listed: ToolSpec[], selected: ToolSpec[], query = ""): ToolSpec[] {
  if (mentionsAppData(query) || !wantsFactualWebSearch(query)) {
    return selected.filter((tool) => tool.name !== "builtin.web.search" && !tool.name.startsWith("COMPOSIO_SEARCH")).slice(0, 12);
  }
  const web = listed.find((tool) => tool.name === "builtin.web.search");
  if (!web || selected.some((tool) => tool.name === web.name)) return selected.slice(0, 12);
  return [web, ...selected].slice(0, 12);
}

/**
 * Load actions for the user's connected toolkits.
 * Important tools (no search) include send. A second search scoped to the same toolkit
 * catches the step's wording.
 */
export async function loadConnectedToolkitTools(
  slugs: string[],
  query: string,
  source: ComposioToolSource
): Promise<ToolSpec[]> {
  const unique = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
  const batches = await Promise.all(
    unique.map(async (slug) => {
      const [important, searched] = await Promise.all([
        source.listRaw({ toolkits: [slug] }).catch(() => [] as RawComposioTool[]),
        query.trim()
          ? source.listRaw({ toolkits: [slug], search: query.slice(0, 80) }).catch(() => [] as RawComposioTool[])
          : Promise.resolve([] as RawComposioTool[]),
      ]);
      return [...important, ...searched];
    })
  );
  return composioToolsFromRaw(batches.flat()).slice(0, 80);
}
