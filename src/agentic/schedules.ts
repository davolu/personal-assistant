import { describeCadence, normalizeCadence, type NormalizedCadence } from "./cadence";
import { SCHEDULE_GOAL_ERROR, transcriptForGoal, validScheduleGoal } from "./schedule-goal";

export type PublicSchedule = {
  id: string;
  threadId: string;
  name: string;
  goal: string;
  cadenceLabel: string;
  timezone: string;
  cron: string;
  kind: NormalizedCadence["kind"];
  time: string;
  weekday: number | null;
  hours: number | null;
  status: "active" | "paused";
  allowRisky: boolean;
  notify: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastSummary: string;
};

export type ScheduleDraft = {
  name: string;
  goal: string;
  cadence: NormalizedCadence;
  notify: boolean;
  allowRisky: boolean;
};

export function contextFromMessages(messages: { role?: string; content?: unknown }[]): string {
  return transcriptForGoal(messages).slice(0, 4000);
}

export function scheduleSeed(input: { goal: string; context: string; allowRisky: boolean }): string {
  return [
    "This is a fresh scheduled run. Do the task again from the beginning. Do not assume an earlier send, delete, or payment already happened.",
    `What to do this run:\n${input.goal}`,
    input.context
      ? `Details already settled in the source chat. Use them. Do not ask again for a target or a choice that is already here:\n${input.context}`
      : "",
    input.allowRisky
      ? "The user allowed sends, deletes, and payments for this schedule. Carry those out. Do not stop to ask for approval."
      : "Sends, deletes, and payments still wait for the user's approval.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function scheduleFromToolArgs(
  input: Record<string, unknown>,
  fallbackGoal: string,
  fallbackZone = "UTC"
): { ok: true; draft: ScheduleDraft; summary: string } | { ok: false; error: string } {
  const goal = validScheduleGoal(input.goal) || validScheduleGoal(fallbackGoal);
  if (!goal) return { ok: false, error: SCHEDULE_GOAL_ERROR };
  const cadence = normalizeCadence(input, fallbackZone);
  if (!cadence.ok) return cadence;
  const name = text(input.name, 80) || goal.slice(0, 80);
  const allowRisky = input.allow_risky === true || input.allowRisky === true;
  const notify = input.notify === false || input.notify === "false" ? false : true;
  const summary = scheduleSummary({ name, cadence: cadence.cadence, allowRisky });
  return { ok: true, draft: { name, goal, cadence: cadence.cadence, notify, allowRisky }, summary };
}

export function parseScheduleRequest(body: unknown, fallbackZone = "UTC"): { ok: true; draft: ScheduleDraft; threadId: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Choose how often this should run." };
  const record = body as Record<string, unknown>;
  const threadId = text(record.threadId, 80);
  if (!threadId) return { ok: false, error: "Open a chat before saving a schedule." };
  const parsed = scheduleFromToolArgs(record, text(record.goal, 4000), validFallback(record.timezone, fallbackZone));
  if (!parsed.ok) return parsed;
  return { ok: true, draft: parsed.draft, threadId };
}

export function toPublicSchedule(row: {
  id: string;
  threadId: string;
  name: string;
  goal: string;
  cadence: NormalizedCadence;
  status: "active" | "paused";
  allowRisky: boolean;
  notify: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastSummary: string;
}): PublicSchedule {
  return {
    id: row.id,
    threadId: row.threadId,
    name: row.name,
    goal: row.goal,
    cadenceLabel: describeCadence(row.cadence),
    timezone: row.cadence.timezone,
    cron: row.cadence.cron,
    kind: row.cadence.kind,
    time: row.cadence.time,
    weekday: row.cadence.weekday,
    hours: row.cadence.hours,
    status: row.status,
    allowRisky: row.allowRisky,
    notify: row.notify,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    lastSummary: row.lastSummary,
  };
}

export function scheduleSummary(input: { name: string; cadence: NormalizedCadence; allowRisky: boolean }): string {
  const risk = input.allowRisky
    ? "Sends, deletes, and payments will run without asking."
    : "Sends, deletes, and payments still wait for approval.";
  return `Save “${input.name}” to run ${describeCadence(input.cadence)} (${input.cadence.timezone}). ${risk}`;
}

export type RunNote = {
  id: string;
  status: string;
  summary: string;
  at: string;
  href?: string;
};

export function noteFromRun(run: { id: string; status: string; summary: string; startedAt: string; runThreadId: string; notify: boolean }): RunNote | null {
  if (!run.notify || run.status === "running") return null;
  return {
    id: run.id,
    status: run.status,
    summary: run.summary,
    at: run.startedAt,
    href: run.status === "waiting" ? `/agentic-chat?thread=${encodeURIComponent(run.runThreadId)}` : undefined,
  };
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function validFallback(zone: unknown, fallback: string): string {
  return typeof zone === "string" && zone.trim() ? zone.trim() : fallback;
}

