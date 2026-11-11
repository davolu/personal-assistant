import type { ToolSpec } from "./types";
import { classifyEffect } from "./policy";
import { tokens } from "./util";

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

/** Pass the query to Composio search and keep the order it returns. Web search stays a builtin. */
export async function loadCatalogTools(query: string, _connectedSlugs: string[], source: ComposioToolSource): Promise<ToolSpec[]> {
  const trimmed = query.trim().slice(0, 200);
  const raw = trimmed ? await source.listRaw({ search: trimmed }).catch(() => [] as RawComposioTool[]) : [];
  return composioToolsFromRaw(raw).filter((tool) => !tool.name.startsWith("COMPOSIO_SEARCH") && !tool.name.startsWith("builtin."));
}

/** Web search is for facts the user asked about, not for discovering apps. */
export function wantsFactualWebSearch(text: string): boolean {
  if (/\b(find|search)\b/i.test(text) && /\btools?\b/i.test(text)) return false;
  if (/\b(api|toolkit|composio|zapier)\b/i.test(text)) return false;
  return /\b(search|look up|latest|news|grants|nonprofit)\b/i.test(text);
}

/** True when the text names a toolkit from the live list, not from a fixed app regex. */
export function mentionsAppData(text: string, names: string[]): boolean {
  const words = new Set(tokens(text));
  return names.some((name) => tokens(name).some((part) => part.length > 3 && words.has(part)));
}

export function ensureSearchTools(listed: ToolSpec[], selected: ToolSpec[], query = "", names: string[] = []): ToolSpec[] {
  if ((names.length > 0 && mentionsAppData(query, names)) || !wantsFactualWebSearch(query)) {
    return selected.filter((tool) => tool.name !== "builtin.web.search" && !tool.name.startsWith("COMPOSIO_SEARCH")).slice(0, 12);
  }
  const web = listed.find((tool) => tool.name === "builtin.web.search");
  if (!web || selected.some((tool) => tool.name === web.name)) return selected.slice(0, 12);
  return [web, ...selected].slice(0, 12);
}

