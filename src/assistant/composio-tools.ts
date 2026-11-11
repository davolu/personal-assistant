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

/** No user OAuth. These are the Composio search toolkit slugs the host always offers. */
export const NO_AUTH_SEARCH_TOOLS = [
  "COMPOSIO_SEARCH_WEB",
  "COMPOSIO_SEARCH_NEWS",
  "COMPOSIO_SEARCH_TAVILY",
  "COMPOSIO_SEARCH_EXA_ANSWER",
  "COMPOSIO_SEARCH_FETCH_URL_CONTENT",
];

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

/**
 * Search the whole Composio catalog for this step, always include no-auth web search,
 * and also load important tools for toolkits the user has already connected.
 */
export async function loadCatalogTools(
  query: string,
  connectedSlugs: string[],
  source: ComposioToolSource
): Promise<ToolSpec[]> {
  const trimmed = query.trim().slice(0, 80);
  const [found, web, connected] = await Promise.all([
    trimmed ? source.listRaw({ search: trimmed }).catch(() => [] as RawComposioTool[]) : Promise.resolve([] as RawComposioTool[]),
    source.listRaw({ tools: NO_AUTH_SEARCH_TOOLS }).catch(() => [] as RawComposioTool[]),
    loadConnectedToolkitTools(connectedSlugs, trimmed, source),
  ]);
  const merged = [...composioToolsFromRaw([...web, ...found]), ...connected];
  if (!merged.some((tool) => tool.name === "COMPOSIO_SEARCH_WEB")) {
    merged.unshift({
      name: "COMPOSIO_SEARCH_WEB",
      description: "Search the public web. No user account is required.",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      effect: "read",
      provider: "composio",
    });
  }
  return merged.filter((tool, index) => merged.findIndex((item) => item.name === tool.name) === index).slice(0, 40);
}

export function ensureSearchTools(listed: ToolSpec[], selected: ToolSpec[]): ToolSpec[] {
  const search = listed.filter((tool) => tool.name.startsWith("COMPOSIO_SEARCH"));
  const missing = search.filter((tool) => !selected.some((item) => item.name === tool.name));
  return [...missing, ...selected].slice(0, 12);
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
