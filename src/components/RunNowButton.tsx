"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RunNowButton({
  agentId,
  size = "sm",
}: {
  agentId: string;
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "done" | "failed">("idle");

  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const json = await res.json();
      setState(res.ok && json.status === "success" ? "done" : "failed");
      router.refresh();
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  const cls =
    size === "lg"
      ? "rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark disabled:opacity-70"
      : "rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-ground transition hover:bg-ink/85 disabled:opacity-70";

  return (
    <button onClick={run} disabled={state === "running"} className={cls}>
      {state === "running" ? (
        <span className="inline-flex items-center gap-2">
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Running…
        </span>
      ) : state === "done" ? (
        "✓ Done — see activity"
      ) : state === "failed" ? (
        "✗ Failed — see activity"
      ) : (
        "▶ Run now"
      )}
    </button>
  );
}
