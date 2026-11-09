"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { streamRun, type RunEvent } from "@/lib/run-stream";
import LiveRunFeed from "@/components/LiveRunFeed";

export default function RunNowButton({
  agentId,
  size = "sm",
}: {
  agentId: string;
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "failed" | "waiting">("idle");
  const [summary, setSummary] = useState("");

  async function run() {
    setState("running");
    setEvents([]);
    setSummary("");
    const finish = await streamRun(agentId, false, (ev) => setEvents((e) => [...e, ev]));
    setState(finish.status === "success" ? "done" : finish.status === "waiting" ? "waiting" : "failed");
    setSummary(finish.summary);
    router.refresh();
  }

  const cls =
    size === "lg"
      ? "rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark disabled:opacity-70"
      : "rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-ground transition hover:bg-ink/85 disabled:opacity-70";

  return (
    <div className={size === "lg" ? "w-full" : ""}>
      <button onClick={run} disabled={state === "running"} className={cls}>
        {state === "running" ? (
          <span className="inline-flex items-center gap-2">
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Running…
          </span>
        ) : (
          "▶ Run now"
        )}
      </button>

      {events.length > 0 && (
        <div className="mt-3 w-full min-w-64 text-left">
          <LiveRunFeed events={events} />
          {state === "done" && (
            <p className="mt-2 rounded-lg bg-mint-soft px-3 py-2 text-xs font-medium text-mint">✓ {summary}</p>
          )}
          {state === "failed" && (
            <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-dark">✗ {summary}</p>
          )}
          {state === "waiting" && (
            <p className="mt-2 rounded-lg bg-gold-soft px-3 py-2 text-xs font-medium text-gold">
              ⏳ Prepared and waiting — approve it from your dashboard. {summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
