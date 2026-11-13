"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/mutate";

export default function DeleteAgentButton({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete "${name}"? Its run history goes with it. This can't be undone.`)) return;
    setBusy(true);
    const res = await mutate("/api/agents/delete", {
      method: "POST",
      body: { agentId },
      success: "Agent deleted",
      failure: "Couldn't delete the agent — try again.",
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-accent-dark transition hover:border-accent-dark/40 hover:bg-accent-soft disabled:opacity-50"
    >
      {busy ? "Deleting…" : "🗑 Delete agent"}
    </button>
  );
}
