"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteAgentButton({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Delete "${name}"? Its run history goes with it. This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch("/api/agents/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      window.alert("Couldn't delete the agent — try again.");
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
