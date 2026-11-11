import type { ResultEnvelope, ToolProvider, ToolSpec } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * One hub for builtin tools, remote MCP servers, and Composio (Ch26, Ch29).
 * Unknown names return an error envelope and do not call a provider.
 */
export class ToolHub {
  constructor(private providers: ToolProvider[], private timeoutMs = DEFAULT_TIMEOUT_MS) {}

  async list(userId: string, query: string): Promise<ToolSpec[]> {
    const groups = await Promise.all(
      this.providers.map((provider) => provider.list(userId, query).catch(() => [] as ToolSpec[]))
    );
    const byName = new Map<string, ToolSpec>();
    for (const tool of groups.flat()) {
      if (!tool.name || byName.has(tool.name)) continue;
      byName.set(tool.name, tool);
    }
    return [...byName.values()];
  }

  async call(userId: string, name: string, args: Record<string, unknown>, allowed: Set<string>): Promise<ResultEnvelope> {
    if (!allowed.has(name)) {
      return { ok: false, error: { code: "NOT_ALLOWLISTED", message: `${name} is not available for this step` } };
    }
    const provider = this.providers.find((candidate) => owns(candidate, name));
    if (!provider) return { ok: false, error: { code: "NOT_ALLOWLISTED", message: `${name} has no provider` } };
    try {
      return await Promise.race([
        provider.call(userId, name, args),
        new Promise<ResultEnvelope>((resolve) =>
          setTimeout(
            () => resolve({ ok: false, error: { code: "TIMEOUT", message: `${name} timed out` } }),
            this.timeoutMs
          )
        ),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "tool failed";
      return { ok: false, error: { code: "TOOL_FAILED", message: message.slice(0, 300) } };
    }
  }
}

function owns(provider: ToolProvider, name: string): boolean {
  if (provider.handles) return provider.handles(name);
  if (provider.id === "builtin") return name.startsWith("builtin.");
  if (provider.id === "mcp") return name.startsWith("mcp.");
  return provider.id === "composio" && !name.startsWith("builtin.") && !name.startsWith("mcp.");
}
