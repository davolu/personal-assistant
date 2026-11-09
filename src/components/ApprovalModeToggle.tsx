"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ApprovalModeToggle({
  agentId,
  mode,
}: {
  agentId: string;
  mode: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch("/api/agents/approval-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, mode: next }),
      });
      if (!res.ok) setValue(prev);
      else router.refresh();
    } catch {
      setValue(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="inline-flex items-center gap-2 font-mono text-xs text-muted">
      Actions
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent disabled:opacity-60"
      >
        <option value="auto">run automatically</option>
        <option value="approve">🔒 ask me first</option>
      </select>
    </label>
  );
}
