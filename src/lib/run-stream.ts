"use client";

import type { RunEvent } from "@/lib/runner";

export type { RunEvent };

/** Stream a run, invoking onEvent per NDJSON line. Resolves with the finish event. */
export async function streamRun(
  agentId: string,
  training: boolean,
  onEvent: (ev: RunEvent) => void
): Promise<Extract<RunEvent, { type: "finish" }>> {
  const res = await fetch("/api/agents/run/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, training }),
  });
  if (!res.ok || !res.body) {
    const fallback = { type: "finish", status: "error", summary: "Request failed — try again.", logId: "" } as const;
    onEvent(fallback);
    return fallback;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finish: Extract<RunEvent, { type: "finish" }> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as RunEvent;
        onEvent(ev);
        if (ev.type === "finish") finish = ev;
      } catch {
        /* skip malformed line */
      }
    }
  }
  return (
    finish ?? { type: "finish", status: "error", summary: "Stream ended unexpectedly.", logId: "" }
  );
}

export function eventLine(ev: RunEvent): { icon: string; text: string; tone: "muted" | "ok" | "err" } | null {
  switch (ev.type) {
    case "start":
      return { icon: "▶", text: `Starting ${ev.agent}…`, tone: "muted" };
    case "thinking":
      return { icon: "🧠", text: `Thinking (step ${ev.step})…`, tone: "muted" };
    case "tool_call":
      return { icon: "→", text: `${ev.tool}`, tone: "muted" };
    case "tool_result":
      return ev.ok
        ? { icon: "✓", text: ev.tool, tone: "ok" }
        : { icon: "✗", text: `${ev.tool}${ev.error ? ` — ${ev.error}` : ""}`, tone: "err" };
    case "note":
      return { icon: "⚠", text: ev.text, tone: "muted" };
    case "reflecting":
      return { icon: "💭", text: "Updating memory with what it learned…", tone: "muted" };
    case "finish":
      return null; // rendered separately as the verdict
  }
}
