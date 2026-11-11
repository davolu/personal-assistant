import type { ToolSpec } from "./types";
import { classifyEffect } from "./policy";

export type RawComposioTool = {
  slug?: string;
  name?: string;
  description?: string;
  inputParameters?: Record<string, unknown>;
  function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
};

export type ComposioToolSource = {
  listRaw(query: { toolkits: string[]; search?: string }): Promise<RawComposioTool[]>;
};

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
 * Load actions for the user's connected toolkits.
 * Important tools (no search) include send. A second search scoped to the same toolkit
 * catches the step's wording. A free-text search with no toolkit is not used: it misses
 * GMAIL_SEND_EMAIL and is not limited to apps the user actually connected.
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
