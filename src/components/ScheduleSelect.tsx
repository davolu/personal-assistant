"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ScheduleSelect({
  agentId,
  schedule,
}: {
  agentId: string;
  schedule: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(schedule);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    const res = await fetch("/api/agents/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, schedule: next }),
    });
    setBusy(false);
    if (!res.ok) setValue(prev);
    else router.refresh();
  }

  return (
    <label className="inline-flex items-center gap-2 font-mono text-xs text-muted">
      Runs
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-line bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent disabled:opacity-60"
      >
        <option value="daily">daily</option>
        <option value="hourly">hourly</option>
        <option value="event" disabled>
          on event (real-time) — coming soon
        </option>
      </select>
    </label>
  );
}
