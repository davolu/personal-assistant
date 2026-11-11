import type { ToolSpec } from "./types";
import { tokens } from "./util";

/**
 * Dynamic tool selection (Ch11, Ch29). Only tools returned here may be called for this step.
 * An empty overlap returns nothing: the model answers without tools instead of guessing.
 */
export function selectTools(query: string, tools: ToolSpec[], limit = 8): ToolSpec[] {
  const q = new Set(tokens(query));
  const scored = tools.map((tool) => {
    const words = tokens(`${tool.name} ${tool.description}`);
    let score = 0;
    for (const word of words) if (q.has(word)) score += 1;
    return { tool, score };
  });
  scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.tool);
}

export function allowlist(tools: ToolSpec[]): Set<string> {
  return new Set(tools.map((t) => t.name));
}
