import { nextRunAfter } from "./cadence";
import type { ScheduleRecord, ScheduleStore } from "./schedule-store";

export type ScheduleOutcome = { status: "success" | "error" | "waiting"; summary: string };

export async function runDueSchedules(
  store: ScheduleStore,
  now: Date,
  execute: (schedule: ScheduleRecord, runThreadId: string) => Promise<ScheduleOutcome>,
  limit = 2
): Promise<{ claimed: number; ran: number }> {
  const due = await store.listDue(now, limit);
  let claimed = 0;
  let ran = 0;
  for (const row of due) {
    const scheduledFor = row.nextRunAt;
    if (!scheduledFor) continue;
    const next = nextRunAfter(row.cadence, now);
    const won = await store.claim(row.id, now, next ? next.toISOString() : null);
    if (!won) continue;
    claimed += 1;
    const runThreadId = `sched-${crypto.randomUUID()}`;
    const run = await store.insertRun({
      scheduleId: row.id,
      userId: row.userId,
      threadId: row.threadId,
      runThreadId,
      name: row.name,
      scheduledFor,
      status: "running",
      summary: "",
      notify: row.notify,
    });
    if (!run) continue;
    try {
      const outcome = await execute(row, runThreadId);
      await store.finishRun(run.id, outcome);
      ran += 1;
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 500) : "The run failed.";
      await store.finishRun(run.id, { status: "error", summary });
    }
  }
  return { claimed, ran };
}
