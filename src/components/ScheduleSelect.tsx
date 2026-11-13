"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { readableError } from "@/lib/readable-error";

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
    try {
      const res = await fetch("/api/agents/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, schedule: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setValue(prev);
        setError(readableError(body.error, "Couldn't change the schedule."));
      } else {
        router.refresh();
      }
    } catch {
      setValue(prev);
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
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
