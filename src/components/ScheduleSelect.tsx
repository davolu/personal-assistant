"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/mutate";

export default function ScheduleSelect({
  agentId,
  schedule,
  eventCapable,
  eventHint,
}: {
  agentId: string;
  schedule: string;
  eventCapable: boolean;
  eventHint?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(schedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    setError("");
    const res = await mutate("/api/agents/schedule", {
      method: "POST",
      body: { agentId, schedule: next },
      success: "Schedule saved",
      failure: "Couldn't change the schedule.",
    });
    if (!res.ok) {
      setValue(prev);
      setError(res.error || "Couldn't change the schedule.");
    } else {
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex flex-col gap-1">
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
          {eventCapable ? (
            <option value="event">on event (real-time)</option>
          ) : (
            <option value="event" disabled>
              on event — not available for this agent&apos;s apps
            </option>
          )}
        </select>
      </label>
      {value === "event" && eventHint && !error && (
        <span className="font-mono text-[11px] text-muted">⚡ fires when {eventHint}</span>
      )}
      {error && <span className="font-mono text-[11px] text-accent-dark">{error}</span>}
    </span>
  );
}
