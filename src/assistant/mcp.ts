import type { ResultEnvelope, ToolSpec } from "./types";
import { classifyEffect } from "./policy";
import { clampText } from "./util";

export interface McpTransport {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
}

export function httpMcpTransport(url: string, headers: Record<string, string> = {}, fetchImpl: typeof fetch = fetch): McpTransport {
  return {
    async request(method, params, timeoutMs) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (!res.ok || json.error) throw new Error(json.error?.message || `MCP HTTP ${res.status}`);
      return json.result;
    },
  };
}

type Listed = { name?: string; description?: string; inputSchema?: Record<string, unknown> };

export async function mcpListTools(server: string, transport: McpTransport, timeoutMs: number): Promise<ToolSpec[]> {
  const result = (await transport.request("tools/list", {}, timeoutMs)) as { tools?: Listed[] };
  return (result.tools ?? []).map((tool) => {
    const name = `mcp.${server}.${tool.name ?? ""}`;
    return {
      name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? {},
      effect: classifyEffect(name),
      provider: "mcp" as const,
    };
  });
}

export async function mcpCallTool(
  transport: McpTransport,
  remoteName: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<ResultEnvelope> {
  try {
    const result = (await transport.request("tools/call", { name: remoteName, arguments: args }, timeoutMs)) as {
      isError?: boolean;
      content?: unknown;
    };
    const raw = JSON.stringify(result.content ?? result);
    const clipped = clampText(raw, 4000);
    if (result.isError) return { ok: false, error: { code: "TOOL_FAILED", message: clipped.text }, truncated: clipped.truncated };
    return { ok: true, data: clipped.text, truncated: clipped.truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "mcp failed";
    const code = /timeout|aborted/i.test(message) ? "TIMEOUT" : "TOOL_FAILED";
    return { ok: false, error: { code, message: message.slice(0, 300) } };
  }
}
