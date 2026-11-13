"use client";

import { useMemo, useState } from "react";

export type ScheduleDraftInput = {
  name: string;
  kind: "daily" | "weekdays" | "weekly" | "interval" | "cron";
  time: string;
  weekday: number;
  hours: number;
  cron: string;
  timezone: string;
  notify: boolean;
  allowRisky: boolean;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KINDS: { id: ScheduleDraftInput["kind"]; label: string; hint: string }[] = [
  { id: "daily", label: "Daily", hint: "Once a day" },
  { id: "weekdays", label: "Weekdays", hint: "Monday to Friday" },
  { id: "weekly", label: "Weekly", hint: "One day a week" },
  { id: "interval", label: "Every few hours", hint: "Around the clock" },
  { id: "cron", label: "Custom", hint: "A cron expression" },
];

export function SchedulePicker({
  initial,
  busy,
  error,
  title = "Run on a schedule",
  submitLabel = "Save schedule",
  onClose,
  onSave,
}: {
  initial: ScheduleDraftInput;
  busy?: boolean;
  error?: string | null;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onSave: (draft: ScheduleDraftInput) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const zones = useMemo(zoneList, []);
  const needsTime = draft.kind === "daily" || draft.kind === "weekdays" || draft.kind === "weekly";

  function save() {
    onSave(draft);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 pb-16 sm:items-center sm:p-6 sm:pb-6" role="presentation" onMouseDown={onClose}>
      <div
        data-schedule-picker
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-picker-title"
        className="surface max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl p-4 sm:max-w-lg sm:rounded-3xl sm:p-6"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="panel-label">Schedule</p>
            <h2 id="schedule-picker-title" className="mt-1 text-xl font-bold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted">Each run starts fresh with this chat’s goal. Sends, deletes, and payments still wait unless you allow them here.</p>
          </div>
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-xl text-lg text-muted hover:bg-ground" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="mt-5 block text-sm font-semibold" htmlFor="schedule-name">Name</label>
        <input
          id="schedule-name"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-accent"
        />

        <p className="mt-5 text-sm font-semibold">How often</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KINDS.map((kind) => {
            const selected = draft.kind === kind.id;
            return (
              <button
                key={kind.id}
                type="button"
                aria-pressed={selected}
                className={`min-h-11 rounded-2xl border px-3 py-2 text-left ${selected ? "border-accent bg-accent-soft" : "border-line bg-ground"}`}
                onClick={() => setDraft({ ...draft, kind: kind.id })}
              >
                <span className="block text-sm font-semibold">{kind.label}</span>
                <span className="block text-[11px] text-muted">{kind.hint}</span>
              </button>
            );
          })}
        </div>

        {needsTime && (
          <label className="mt-4 block text-sm font-semibold">
            Time
            <input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-accent" />
          </label>
        )}
        {draft.kind === "weekly" && (
          <label className="mt-4 block text-sm font-semibold">
            Day
            <select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-accent">
              {DAYS.map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          </label>
        )}
        {draft.kind === "interval" && (
          <label className="mt-4 block text-sm font-semibold">
            Hours between runs
            <input type="number" min={1} max={23} value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-accent" />
          </label>
        )}
        {draft.kind === "cron" && (
          <label className="mt-4 block text-sm font-semibold">
            Cron
            <input value={draft.cron} onChange={(event) => setDraft({ ...draft, cron: event.target.value })} placeholder="0 9 * * 1" className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 font-mono text-sm outline-none focus:border-accent" />
            <span className="mt-1 block text-xs font-normal text-muted">Minute, hour, day of month, month, day of week.</span>
          </label>
        )}

        <label className="mt-4 block text-sm font-semibold">
          Timezone
          <select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-ground px-3 text-sm outline-none focus:border-accent">
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
        </label>

        <label className="mt-4 flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={draft.notify} onChange={(event) => setDraft({ ...draft, notify: event.target.checked })} />
          <span>
            <span className="font-semibold">Leave the result in this chat</span>
            <span className="mt-0.5 block text-xs text-muted">A finished run shows up as a new note. The schedule page always keeps the history.</span>
          </span>
        </label>
        <label className="mt-2 flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4" checked={draft.allowRisky} onChange={(event) => setDraft({ ...draft, allowRisky: event.target.checked })} />
          <span>
            <span className="font-semibold">Allow sends, deletes, and payments without asking</span>
            <span className="mt-0.5 block text-xs text-muted">Leave this off unless those actions should run on their own for this schedule.</span>
          </span>
        </label>

        {error && <p className="mt-3 text-sm text-accent-dark">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="btn-ink px-4 text-sm disabled:opacity-50" onClick={save}>
            {busy ? "Saving…" : submitLabel}
          </button>
          <button type="button" className="btn-ghost px-4 text-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptyDraft(name: string, timezone = browserZone()): ScheduleDraftInput {
  return { name, kind: "daily", time: "09:00", weekday: 1, hours: 2, cron: "0 9 * * 1", timezone, notify: true, allowRisky: false };
}

function zoneList(): string[] {
  const detected = browserZone();
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes(detected) ? zones : [detected, ...zones];
  } catch {
    return [detected, "UTC"];
  }
}
