import type { Span } from "./types";
import { redactForLog } from "./filters";

export function createTracer(now: () => number = Date.now) {
  const spans: Span[] = [];
  let n = 0;
  return {
    spans,
    span(name: string, attributes: Record<string, string | number | boolean>, parentId?: string): void {
      const at = now();
      const safe: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(attributes)) {
        safe[key] = typeof value === "string" ? redactForLog(value).slice(0, 200) : value;
      }
      spans.push({ id: `s${++n}`, parentId, name, startMs: at, endMs: at, attributes: safe });
    },
  };
}
