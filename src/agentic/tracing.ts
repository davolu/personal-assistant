import { randomUUID } from "node:crypto";
import { redactSecrets } from "@/assistant/filters";

export interface Tracer {
  event(name: string, attrs?: Record<string, string>): void;
  flush(): Promise<void>;
}

export function createTracer(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Tracer {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return { event() {}, async flush() {} };
  const base = (env.LANGFUSE_BASE_URL || env.LANGFUSE_HOST || "https://cloud.langfuse.com").replace(/\/$/, "");
  const traceId = randomUUID();
  const batch: Record<string, unknown>[] = [];
  batch.push({
    id: randomUUID(),
    type: "trace-create",
    timestamp: new Date().toISOString(),
    body: { id: traceId, name: "agentic-turn", timestamp: new Date().toISOString() },
  });
  return {
    event(name, attrs = {}) {
      const safe: Record<string, string> = {};
      for (const [key, value] of Object.entries(attrs)) safe[key] = redactSecrets(value).slice(0, 500);
      batch.push({
        id: randomUUID(),
        type: "span-create",
        timestamp: new Date().toISOString(),
        body: {
          id: randomUUID(),
          traceId,
          name,
          input: safe,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
        },
      });
    },
    async flush() {
      if (batch.length === 0) return;
      const token = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
      try {
        await fetchImpl(`${base}/api/public/ingestion`, {
          method: "POST",
          headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ batch }),
        });
      } catch {
        // Tracing is optional. A collector outage does not end the turn.
      }
    },
  };
}
