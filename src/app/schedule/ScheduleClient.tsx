"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { visibleRunOutput } from "@/agentic/schedule-goal";
import { EmptyArt } from "@/components/illustrations";
import { mutate } from "@/lib/mutate";
import { readableError } from "@/lib/readable-error";
import { friendlyText, notify } from "@/lib/toast";
import { SchedulePicker, type ScheduleDraftInput } from "@/components/SchedulePicker";
import type { PublicSchedule } from "@/agentic/schedules";

type RunState = { id: string; status: string; summary: string } | null;

export function ScheduleClient({ preview = false }: { preview?: boolean }) {
  const [schedules, setSchedules] = useState<PublicSchedule[]>(preview ? PREVIEW : []);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [running, setRunning] = useState<RunState>(null);

  async function load() {
    if (preview) return;
    const res = await fetch("/api/schedules");
    if (res.status === 401) {
      setSignedOut(true);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { schedules?: PublicSchedule[]; error?: string };
    if (!res.ok) setError(readableError(json.error, "Could not load schedules"));
    else setSchedules(json.schedules ?? []);
  }

  useEffect(() => {
    void load();
  }, [preview]);

  async function patch(id: string, body: Record<string, unknown>) {
    const success = scheduleSavedMessage(body);
    if (preview) {
      setSchedules((current) => current.map((row) => (row.id === id ? { ...row, ...previewPatch(row, body) } : row)));
      notify(success, "success");
      return;
    }
    const res = await mutate(`/api/schedules/${id}`, {
      method: "PATCH",
      body,
      success,
      failure: "Could not update that schedule",
    });
    if (!res.ok) setError(res.error || "Could not update that schedule");
    await load();
  }

  async function remove(id: string) {
    if (preview) {
      setSchedules((current) => current.filter((row) => row.id !== id));
      setConfirmId(null);
      notify("Schedule deleted", "success");
      return;
    }
    const res = await mutate(`/api/schedules/${id}`, {
      method: "DELETE",
      success: "Schedule deleted",
      failure: "Could not delete that schedule",
    });
    if (!res.ok) setError(res.error || "Could not delete that schedule");
    setConfirmId(null);
    await load();
  }

  async function runNow(id: string) {
    if (preview) {
      setSchedules((current) => current.map((row) => (row.id === id ? { ...row, lastStatus: "success", lastSummary: "Preview run finished in this chat." } : row)));
      setRunning(null);
      notify("Run finished", "success");
      return;
    }
    setRunning({ id, status: "running", summary: "Starting…" });
    const res = await mutate<{ status?: string; summary?: string }>(`/api/schedules/${id}/run`, {
      method: "POST",
      failure: "Could not start that run",
      outcome: (data) => runOutcome(data as { status?: string; summary?: string } | null),
    });
    if (!res.ok) setRunning({ id, status: "error", summary: res.error || "Could not start that run" });
    else setRunning({ id, status: res.data.status || "success", summary: res.data.summary || "Run finished." });
    await load();
  }

  async function saveEdit(draft: ScheduleDraftInput) {
    if (!editing) return;
    setBusy(true);
    setPickerError(null);
    if (preview) {
      setSchedules((current) => current.map((row) => (row.id === editing.id ? { ...row, name: draft.name, goal: draft.goal, kind: draft.kind, time: draft.time, weekday: draft.weekday, hours: draft.hours, cron: draft.cron, timezone: draft.timezone, notify: draft.notify, allowRisky: draft.allowRisky, cadenceLabel: labelFor(draft) } : row)));
      setEditing(null);
      setBusy(false);
      notify("Schedule saved", "success");
      return;
    }
    const res = await mutate(`/api/schedules/${editing.id}`, {
      method: "PATCH",
      body: draft,
      success: "Schedule saved",
      failure: "Could not save that cadence",
    });
    setBusy(false);
    if (!res.ok) {
      setPickerError(res.error || "Could not save that cadence");
      return;
    }
    setEditing(null);
    await load();
  }

  return (
    <div data-schedule-page className="mx-auto max-w-3xl px-4 py-4 sm:px-5 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker max-md:hidden">Schedule</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl max-md:hidden">Schedules</h1>
          <p className="mt-2 max-w-xl text-sm text-muted max-md:mt-0">Chats you saved to run on their own. Each run starts fresh, with the same tools and the same approval rules.</p>
        </div>
        <Link href="/agentic-chat" className="btn-ink text-sm">
          Open chat
        </Link>
      </div>

      {signedOut && (
        <p className="mt-6 text-sm">
          <Link className="font-semibold underline" href="/signin?next=/schedule">Sign in</Link> to see your schedules.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-accent-dark">{error}</p>}

      {!signedOut && schedules.length === 0 && (
        <div className="surface mt-8 px-6 py-12 text-center">
          <EmptyArt kind="schedules" />
          <p className="text-lg font-semibold">No schedules yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Open a chat and choose Schedule. You can also ask the agent to run something again.</p>
          <Link href="/agentic-chat" className="btn-ink mt-5 text-sm">
            Open chat
          </Link>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {schedules.map((schedule) => (
          <li key={schedule.id} className="surface lift p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">{schedule.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{schedule.goal}</p>
              </div>
              <StatusPill status={schedule.status === "paused" ? "paused" : schedule.lastStatus || "active"} />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="panel-label">Cadence</dt>
                <dd className="mt-1 font-medium">{schedule.cadenceLabel}</dd>
                <dd className="text-xs text-muted">{schedule.timezone}</dd>
              </div>
              <div>
                <dt className="panel-label">Next run</dt>
                <dd className="mt-1 font-medium">{schedule.status === "paused" ? "Paused" : when(schedule.nextRunAt, schedule.timezone)}</dd>
              </div>
              <div>
                <dt className="panel-label">Last run</dt>
                <dd className="mt-1 font-medium">{schedule.lastStatus ? schedule.lastStatus : "Not run yet"}</dd>
                <dd className="text-xs text-muted">{schedule.lastRunAt ? when(schedule.lastRunAt, schedule.timezone) : "—"}</dd>
              </div>
            </dl>
            <ScheduleResult summary={schedule.lastSummary} live={running?.id === schedule.id ? running : null} allowRisky={schedule.allowRisky} />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost px-3 text-sm" onClick={() => void patch(schedule.id, { status: schedule.status === "paused" ? "active" : "paused" })}>
                {schedule.status === "paused" ? "Resume" : "Pause"}
              </button>
              <button type="button" className="btn-ink px-3 text-sm" onClick={() => void runNow(schedule.id)}>
                Run now
              </button>
              <button type="button" className="btn-ghost px-3 text-sm" onClick={() => { setPickerError(null); setEditing(schedule); }}>
                Edit
              </button>
              <Link href={`/agentic-chat?thread=${encodeURIComponent(schedule.threadId)}`} className="btn-ghost px-3 text-sm">
                Open chat
              </Link>
              <button type="button" className="min-h-11 rounded-xl px-3 text-sm font-semibold text-danger" onClick={() => setConfirmId(schedule.id)}>
                Delete
              </button>
            </div>
            {confirmId === schedule.id && (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger-soft p-3">
                <p className="text-sm font-semibold">Delete this schedule?</p>
                <p className="mt-1 text-xs text-muted">Future runs stop. Notes already in the chat stay.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-xl bg-danger px-3 text-sm font-semibold text-white" onClick={() => void remove(schedule.id)}>
                    Delete
                  </button>
                  <button type="button" className="min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold" onClick={() => setConfirmId(null)}>
                    Keep
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editing && (
        <SchedulePicker
          key={editing.id}
          title="Edit cadence"
          submitLabel="Save cadence"
          initial={{
            name: editing.name,
            goal: editing.goal,
            kind: editing.kind,
            time: editing.time || "09:00",
            weekday: editing.weekday ?? 1,
            hours: editing.hours ?? 2,
            cron: editing.cron,
            timezone: editing.timezone,
            notify: editing.notify,
            allowRisky: editing.allowRisky,
          }}
          busy={busy}
          error={pickerError}
          onClose={() => setEditing(null)}
          onSave={(draft) => void saveEdit(draft)}
        />
      )}
    </div>
  );
}

function ScheduleResult({ summary, live, allowRisky }: { summary: string; live: { status: string; summary: string } | null; allowRisky: boolean }) {
  const shown = visibleRunOutput(summary, live);
  return (
    <>
      <RunOutput text={shown.output} />
      {allowRisky && <p className="mt-2 text-xs font-semibold text-gold">Sends, deletes, and payments run without asking.</p>}
      {shown.pending && <p className="mt-2 text-sm text-muted">{shown.pending}</p>}
    </>
  );
}

function RunOutput({ text }: { text: string }) {
  if (!text) return null;
  const long = text.length > 180 || text.includes("\n");
  if (!long) return <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{text}</p>;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink/80">Last result</summary>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{text}</p>
    </details>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "success" || status === "active" ? "bg-mint-soft text-mint" : status === "error" ? "bg-danger-soft text-danger" : status === "waiting" ? "bg-gold-soft text-gold" : "bg-ground text-muted";
  const label = status === "active" ? "Ready" : status;
  return <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>;
}

function when(iso: string | null, timeZone: string): string {
  if (!iso) return "Not scheduled";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

function labelFor(draft: ScheduleDraftInput): string {
  if (draft.kind === "daily") return `Daily at ${draft.time}`;
  if (draft.kind === "weekdays") return `Weekdays at ${draft.time}`;
  if (draft.kind === "weekly") return `Weekly on day ${draft.weekday} at ${draft.time}`;
  if (draft.kind === "interval") return `Every ${draft.hours} hours`;
  return `Cron ${draft.cron}`;
}

function scheduleSavedMessage(body: Record<string, unknown>): string {
  if (body.status === "paused") return "Schedule paused";
  if (body.status === "active") return "Schedule resumed";
  return "Schedule saved";
}

function runOutcome(data: { status?: string; summary?: string } | null): { tone: "success" | "error" | "warning"; message: string } {
  if (data?.status === "error") return { tone: "error", message: friendlyText(data.summary, "Could not start that run") };
  if (data?.status === "waiting") return { tone: "warning", message: "Waiting for approval" };
  return { tone: "success", message: "Run finished" };
}

function previewPatch(row: PublicSchedule, body: Record<string, unknown>): PublicSchedule {
  const status = body.status === "paused" || body.status === "active" ? body.status : row.status;
  return { ...row, status };
}

const PREVIEW: PublicSchedule[] = [
  {
    id: "preview-1",
    threadId: "preview-thread",
    name: "Friday recap",
    goal: "Pull the open threads and draft a short recap.",
    cadenceLabel: "Weekdays at 9:00 AM",
    timezone: "America/New_York",
    cron: "0 9 * * 1-5",
    kind: "weekdays",
    time: "09:00",
    weekday: null,
    hours: null,
    status: "active",
    allowRisky: false,
    notify: true,
    nextRunAt: "2026-11-16T14:00:00.000Z",
    lastRunAt: "2026-11-13T14:00:00.000Z",
    lastStatus: "success",
    lastSummary: "Drafted the recap and left it in the chat for review.",
  },
  {
    id: "preview-2",
    threadId: "preview-thread-2",
    name: "Inbox sweep",
    goal: "Look through new mail and list what needs a reply.",
    cadenceLabel: "Every 2 hours",
    timezone: "America/New_York",
    cron: "0 */2 * * *",
    kind: "interval",
    time: "",
    weekday: null,
    hours: 2,
    status: "active",
    allowRisky: false,
    notify: true,
    nextRunAt: "2026-11-13T16:00:00.000Z",
    lastRunAt: "2026-11-13T14:00:00.000Z",
    lastStatus: "waiting",
    lastSummary: "Waiting for approval before anything is sent.",
  },
];
