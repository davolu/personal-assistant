import { cadenceFromRow, nextRunAfter, type NormalizedCadence } from "./cadence";
import { agenticPool } from "./postgres";
import { goalNeedsRepair, validScheduleGoal } from "./schedule-goal";
import { contextFromMessages, scheduleFromToolArgs, scheduleSummary, type ScheduleDraft } from "./schedules";

export type ScheduleRecord = {
  id: string;
  userId: string;
  threadId: string;
  name: string;
  goal: string;
  context: string;
  cadence: NormalizedCadence;
  status: "active" | "paused";
  allowRisky: boolean;
  notify: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string;
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleRunRecord = {
  id: string;
  scheduleId: string;
  userId: string;
  threadId: string;
  runThreadId: string;
  name: string;
  scheduledFor: string;
  status: "running" | "success" | "error" | "waiting";
  summary: string;
  notify: boolean;
  startedAt: string;
  finishedAt: string | null;
};

export type SchedulePatch = {
  name?: string;
  cadence?: NormalizedCadence;
  status?: "active" | "paused";
  notify?: boolean;
  allowRisky?: boolean;
  context?: string;
  goal?: string;
};

export interface ScheduleStore {
  create(input: { userId: string; threadId: string; draft: ScheduleDraft; context: string }): Promise<ScheduleRecord>;
  list(userId: string): Promise<ScheduleRecord[]>;
  get(userId: string, id: string): Promise<ScheduleRecord | null>;
  update(userId: string, id: string, patch: SchedulePatch, now: Date): Promise<ScheduleRecord | null>;
  listBroken(userId: string | null, limit: number): Promise<ScheduleRecord[]>;
  setGoal(userId: string, id: string, goal: string, previous: string): Promise<ScheduleRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  listDue(now: Date, limit: number): Promise<ScheduleRecord[]>;
  claim(id: string, now: Date, nextRunAt: string | null): Promise<ScheduleRecord | null>;
  insertRun(input: Omit<ScheduleRunRecord, "id" | "startedAt" | "finishedAt"> & { id?: string }): Promise<ScheduleRunRecord | null>;
  finishRun(runId: string, outcome: { status: "success" | "error" | "waiting"; summary: string }): Promise<void>;
  listRuns(userId: string, limit: number): Promise<ScheduleRunRecord[]>;
  listRunsForThread(userId: string, threadId: string, limit: number): Promise<ScheduleRunRecord[]>;
  findRunByThread(userId: string, runThreadId: string): Promise<ScheduleRunRecord | null>;
}

export function postgresScheduleStore(): ScheduleStore | null {
  const db = agenticPool();
  if (!db) return null;
  return {
    async create(input) {
      const id = crypto.randomUUID();
      const next = nextRunAfter(input.draft.cadence, new Date());
      const found = await db.query(
        `INSERT INTO agentic_schedule
          (id, user_id, thread_id, name, goal, context, cadence, cron, timezone, status, allow_risky, notify, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active', $10, $11, $12)
         RETURNING *`,
        [
          id,
          input.userId,
          input.threadId,
          input.draft.name,
          input.draft.goal,
          input.context,
          JSON.stringify(input.draft.cadence),
          input.draft.cadence.cron,
          input.draft.cadence.timezone,
          input.draft.allowRisky,
          input.draft.notify,
          next,
        ]
      );
      return mapSchedule(found.rows[0]);
    },
    async list(userId) {
      const found = await db.query("SELECT * FROM agentic_schedule WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100", [userId]);
      return found.rows.map(mapSchedule);
    },
    async get(userId, id) {
      const found = await db.query("SELECT * FROM agentic_schedule WHERE id = $1 AND user_id = $2", [id, userId]);
      return found.rows[0] ? mapSchedule(found.rows[0]) : null;
    },
    async update(userId, id, patch, now) {
      const current = await db.query("SELECT * FROM agentic_schedule WHERE id = $1 AND user_id = $2", [id, userId]);
      if (!current.rows[0]) return null;
      const row = mapSchedule(current.rows[0]);
      const cadence = patch.cadence ?? row.cadence;
      const status = patch.status ?? row.status;
      const next = status === "paused" ? row.nextRunAt : nextRunAfter(cadence, now)?.toISOString() ?? row.nextRunAt;
      const updated = await db.query(
        `UPDATE agentic_schedule
         SET name = $3, goal = $4, context = $5, cadence = $6::jsonb, cron = $7, timezone = $8,
             status = $9, allow_risky = $10, notify = $11, next_run_at = $12, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [
          id,
          userId,
          patch.name ?? row.name,
          patch.goal ?? row.goal,
          patch.context ?? row.context,
          JSON.stringify(cadence),
          cadence.cron,
          cadence.timezone,
          status,
          patch.allowRisky ?? row.allowRisky,
          patch.notify ?? row.notify,
          next,
        ]
      );
      return updated.rows[0] ? mapSchedule(updated.rows[0]) : null;
    },
    async listBroken(userId, limit) {
      const found = await db.query(
        `SELECT * FROM agentic_schedule
         WHERE ($1::text IS NULL OR user_id = $1)
           AND (
             btrim(goal) = ''
             OR regexp_replace(btrim(goal), '[[:space:]]+', ' ', 'g') ~ '^[0-9]+([.][0-9]+)?$'
           )
         ORDER BY updated_at ASC
         LIMIT $2`,
        [userId, limit]
      );
      return found.rows.map(mapSchedule).filter((row) => goalNeedsRepair(row.goal));
    },
    async setGoal(userId, id, goal, previous) {
      const next = validScheduleGoal(goal);
      if (!next || !goalNeedsRepair(previous) || next === previous) return null;
      const updated = await db.query(
        `UPDATE agentic_schedule
         SET goal = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND goal = $4
         RETURNING *`,
        [id, userId, next, previous]
      );
      return updated.rows[0] ? mapSchedule(updated.rows[0]) : null;
    },
    async delete(userId, id) {
      const removed = await db.query("DELETE FROM agentic_schedule WHERE id = $1 AND user_id = $2", [id, userId]);
      return (removed.rowCount ?? 0) > 0;
    },
    async listDue(now, limit) {
      const found = await db.query(
        "SELECT * FROM agentic_schedule WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= $1 ORDER BY next_run_at ASC LIMIT $2",
        [now, limit]
      );
      return found.rows.map(mapSchedule);
    },
    async claim(id, now, nextRunAt) {
      const updated = await db.query(
        `UPDATE agentic_schedule
         SET next_run_at = $2, updated_at = now()
         WHERE id = $1 AND status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= $3
         RETURNING *`,
        [id, nextRunAt, now]
      );
      return updated.rows[0] ? mapSchedule(updated.rows[0]) : null;
    },
    async insertRun(input) {
      const id = input.id ?? crypto.randomUUID();
      try {
        const inserted = await db.query(
          `INSERT INTO agentic_schedule_run
            (id, schedule_id, user_id, thread_id, run_thread_id, name, scheduled_for, status, summary, notify)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [id, input.scheduleId, input.userId, input.threadId, input.runThreadId, input.name, input.scheduledFor, input.status, input.summary, input.notify]
        );
        return mapRun(inserted.rows[0]);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") return null;
        throw error;
      }
    },
    async finishRun(runId, outcome) {
      const updated = await db.query(
        `UPDATE agentic_schedule_run
         SET status = $2, summary = $3, finished_at = CASE WHEN $2 = 'waiting' THEN NULL ELSE now() END
         WHERE id = $1
         RETURNING *`,
        [runId, outcome.status, outcome.summary.slice(0, 2000)]
      );
      const run = updated.rows[0];
      if (!run) return;
      await db.query(
        "UPDATE agentic_schedule SET last_status = $2, last_summary = $3, last_run_at = now(), updated_at = now() WHERE id = $1",
        [run.schedule_id, outcome.status, outcome.summary.slice(0, 2000)]
      );
    },
    async listRuns(userId, limit) {
      const found = await db.query("SELECT * FROM agentic_schedule_run WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2", [userId, limit]);
      return found.rows.map(mapRun);
    },
    async listRunsForThread(userId, threadId, limit) {
      const found = await db.query(
        "SELECT * FROM agentic_schedule_run WHERE user_id = $1 AND thread_id = $2 ORDER BY started_at DESC LIMIT $3",
        [userId, threadId, limit]
      );
      return found.rows.map(mapRun);
    },
    async findRunByThread(userId, runThreadId) {
      const found = await db.query("SELECT * FROM agentic_schedule_run WHERE user_id = $1 AND run_thread_id = $2", [userId, runThreadId]);
      return found.rows[0] ? mapRun(found.rows[0]) : null;
    },
  };
}

export function createMemoryScheduleStore(): ScheduleStore {
  const schedules = new Map<string, ScheduleRecord>();
  const runs = new Map<string, ScheduleRunRecord>();
  return {
    async create(input) {
      const now = new Date().toISOString();
      const row: ScheduleRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        threadId: input.threadId,
        name: input.draft.name,
        goal: input.draft.goal,
        context: input.context,
        cadence: input.draft.cadence,
        status: "active",
        allowRisky: input.draft.allowRisky,
        notify: input.draft.notify,
        nextRunAt: nextRunAfter(input.draft.cadence, new Date())?.toISOString() ?? null,
        lastRunAt: null,
        lastStatus: "",
        lastSummary: "",
        createdAt: now,
        updatedAt: now,
      };
      schedules.set(row.id, row);
      return row;
    },
    async list(userId) {
      return [...schedules.values()].filter((row) => row.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(userId, id) {
      const row = schedules.get(id);
      return row && row.userId === userId ? row : null;
    },
    async update(userId, id, patch, now) {
      const row = schedules.get(id);
      if (!row || row.userId !== userId) return null;
      const cadence = patch.cadence ?? row.cadence;
      const status = patch.status ?? row.status;
      const next = { ...row, ...patch, cadence, status, updatedAt: now.toISOString() };
      next.nextRunAt = status === "paused" ? row.nextRunAt : nextRunAfter(cadence, now)?.toISOString() ?? row.nextRunAt;
      schedules.set(id, next);
      return next;
    },
    async listBroken(userId, limit) {
      return [...schedules.values()]
        .filter((row) => (userId == null || row.userId === userId) && goalNeedsRepair(row.goal))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, limit);
    },
    async setGoal(userId, id, goal, previous) {
      const row = schedules.get(id);
      const next = validScheduleGoal(goal);
      if (!row || row.userId !== userId || row.goal !== previous || !goalNeedsRepair(previous) || !next || next === previous) return null;
      const updated = { ...row, goal: next, updatedAt: new Date().toISOString() };
      schedules.set(id, updated);
      return updated;
    },
    async delete(userId, id) {
      const row = schedules.get(id);
      if (!row || row.userId !== userId) return false;
      schedules.delete(id);
      return true;
    },
    async listDue(now, limit) {
      return [...schedules.values()]
        .filter((row) => row.status === "active" && row.nextRunAt && new Date(row.nextRunAt).getTime() <= now.getTime())
        .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))
        .slice(0, limit);
    },
    async claim(id, now, nextRunAt) {
      const row = schedules.get(id);
      if (!row || row.status !== "active" || !row.nextRunAt || new Date(row.nextRunAt).getTime() > now.getTime()) return null;
      const claimed = { ...row, nextRunAt, updatedAt: now.toISOString() };
      schedules.set(id, claimed);
      return claimed;
    },
    async insertRun(input) {
      const key = `${input.scheduleId}:${input.scheduledFor}`;
      if ([...runs.values()].some((run) => `${run.scheduleId}:${run.scheduledFor}` === key)) return null;
      const row: ScheduleRunRecord = {
        id: input.id ?? crypto.randomUUID(),
        scheduleId: input.scheduleId,
        userId: input.userId,
        threadId: input.threadId,
        runThreadId: input.runThreadId,
        name: input.name,
        scheduledFor: input.scheduledFor,
        status: input.status,
        summary: input.summary,
        notify: input.notify,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };
      runs.set(row.id, row);
      return row;
    },
    async finishRun(runId, outcome) {
      const run = runs.get(runId);
      if (!run) return;
      runs.set(runId, { ...run, status: outcome.status, summary: outcome.summary, finishedAt: outcome.status === "waiting" ? null : new Date().toISOString() });
      const schedule = schedules.get(run.scheduleId);
      if (!schedule) return;
      schedules.set(schedule.id, { ...schedule, lastStatus: outcome.status, lastSummary: outcome.summary, lastRunAt: new Date().toISOString() });
    },
    async listRuns(userId, limit) {
      return [...runs.values()].filter((run) => run.userId === userId).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
    },
    async listRunsForThread(userId, threadId, limit) {
      return [...runs.values()]
        .filter((run) => run.userId === userId && run.threadId === threadId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    },
    async findRunByThread(userId, runThreadId) {
      return [...runs.values()].find((run) => run.userId === userId && run.runThreadId === runThreadId) ?? null;
    },
  };
}

export async function saveApprovedSchedule(input: {
  userId: string;
  threadId: string;
  goal: string;
  messages: { role?: string; content?: unknown }[];
  args: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string }> {
  const store = postgresScheduleStore();
  if (!store) return { ok: false, message: "Schedules need a database connection before they can be saved." };
  const parsed = scheduleFromToolArgs(input.args, input.goal);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const context = contextFromMessages(input.messages);
  const row = await store.create({ userId: input.userId, threadId: input.threadId, draft: parsed.draft, context });
  const when = row.nextRunAt ? new Date(row.nextRunAt).toISOString() : "soon";
  return { ok: true, message: `${scheduleSummary(parsed.draft)} Next run ${when}.` };
}

type Row = Record<string, unknown>;

function mapSchedule(row: Row): ScheduleRecord {
  const raw = typeof row.cadence === "string" ? JSON.parse(row.cadence) : row.cadence;
  const cadence = cadenceFromRow(raw) ?? cadenceFromRow({ kind: "cron", cron: row.cron, timezone: row.timezone }) ?? {
    kind: "cron" as const,
    time: "",
    weekday: null,
    hours: null,
    cron: "0 0 1 1 *",
    timezone: "UTC",
  };
  return {
    id: String(row.id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    name: String(row.name ?? ""),
    goal: String(row.goal ?? ""),
    context: String(row.context ?? ""),
    cadence: cadence as NormalizedCadence,
    status: row.status === "paused" ? "paused" : "active",
    allowRisky: row.allow_risky === true,
    notify: row.notify !== false,
    nextRunAt: stamp(row.next_run_at),
    lastRunAt: stamp(row.last_run_at),
    lastStatus: String(row.last_status ?? ""),
    lastSummary: String(row.last_summary ?? ""),
    createdAt: stamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: stamp(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function mapRun(row: Row): ScheduleRunRecord {
  const status = String(row.status ?? "running");
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id),
    userId: String(row.user_id),
    threadId: String(row.thread_id),
    runThreadId: String(row.run_thread_id),
    name: String(row.name ?? ""),
    scheduledFor: stamp(row.scheduled_for) ?? new Date(0).toISOString(),
    status: status === "success" || status === "error" || status === "waiting" ? status : "running",
    summary: String(row.summary ?? ""),
    notify: row.notify !== false,
    startedAt: stamp(row.started_at) ?? new Date(0).toISOString(),
    finishedAt: stamp(row.finished_at),
  };
}

function stamp(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
