import { readInterrupt, threadConfig } from "./graph";
import { modelFor } from "./model-choice";
import { ensureRunThread } from "./postgres";
import { openMeteredRun } from "./run-guard";
import { getAgenticGraph, missingModelMessage } from "./runtime";
import { runDueSchedules, type ScheduleOutcome } from "./schedule-due";
import { postgresScheduleStore, type ScheduleRecord, type ScheduleStore } from "./schedule-store";
import { scheduleSeed } from "./schedules";

export type { ScheduleOutcome };
export { runDueSchedules };

export async function runDueChatSchedules(now = new Date()): Promise<{ claimed: number; ran: number }> {
  const store = postgresScheduleStore();
  if (!store) return { claimed: 0, ran: 0 };
  try {
    const { repairBrokenScheduleGoals } = await import("./schedule-repair");
    await repairBrokenScheduleGoals(null).catch(() => undefined);
    return await runDueSchedules(store, now, executeScheduleRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/agentic_schedule|does not exist/i.test(message)) return { claimed: 0, ran: 0 };
    throw error;
  }
}

export async function executeScheduleRun(schedule: ScheduleRecord, runThreadId: string): Promise<ScheduleOutcome> {
  if (missingModelMessage()) return { status: "error", summary: "No model is configured yet, so this run did not start." };
  const opened = await openMeteredRun(schedule.userId, runThreadId, "schedule", true);
  if (!opened.ok) return { status: "error", summary: opened.message.slice(0, 500) };
  try {
    const modelId = (await modelFor(schedule.userId, schedule.threadId, process.env, opened.plan)) ?? "";
    if (!modelId) return { status: "error", summary: "No model is configured yet, so this run did not start." };
    await ensureRunThread(schedule.userId, runThreadId, schedule.name).catch(() => undefined);
    const { graph } = await getAgenticGraph(undefined, opened.meter);
    const result = await graph.invoke(
      {
        messages: [{ role: "user", content: scheduleSeed(schedule) }],
        userId: schedule.userId,
        goal: schedule.goal,
        threadId: runThreadId,
        modelId,
        plan: opened.plan,
        startedAt: Date.now(),
        activeMs: 0,
        touchedAt: Date.now(),
        status: "running",
        toolCalls: 0,
        approaches: [],
        trace: [],
        ledger: [],
        verifyRetries: 0,
        pending: null,
        allowExternal: schedule.allowRisky,
        finalAnswer: "",
      },
      threadConfig(runThreadId)
    );
    return outcomeFromResult(result);
  } finally {
    await opened.release();
  }
}

export function outcomeFromResult(result: unknown): ScheduleOutcome {
  const interrupt = readInterrupt(result) as { kind?: string; summary?: string; question?: string } | null;
  if (interrupt) {
    const summary = interrupt.summary || interrupt.question || "This run is waiting for you.";
    return { status: "waiting", summary: String(summary).slice(0, 2000) };
  }
  const answer = String((result as { finalAnswer?: string }).finalAnswer ?? "").trim();
  if (answer) return { status: "success", summary: answer.slice(0, 2000) };
  return { status: "error", summary: "The run finished without a result." };
}

export async function recordRunOutcome(userId: string, threadId: string, result: unknown): Promise<void> {
  const store = postgresScheduleStore();
  if (!store) return;
  const run = await store.findRunByThread(userId, threadId);
  if (!run || run.status === "success" || run.status === "error") return;
  await store.finishRun(run.id, outcomeFromResult(result));
}

export async function runScheduleNow(store: ScheduleStore, schedule: ScheduleRecord, execute: (schedule: ScheduleRecord, runThreadId: string) => Promise<ScheduleOutcome>) {
  const runThreadId = `sched-${crypto.randomUUID()}`;
  const run = await store.insertRun({
    scheduleId: schedule.id,
    userId: schedule.userId,
    threadId: schedule.threadId,
    runThreadId,
    name: schedule.name,
    scheduledFor: new Date().toISOString(),
    status: "running",
    summary: "",
    notify: schedule.notify,
  });
  if (!run) return { status: "error" as const, summary: "That run is already recorded.", runThreadId };
  try {
    const outcome = await execute(schedule, runThreadId);
    await store.finishRun(run.id, outcome);
    return { ...outcome, runThreadId };
  } catch (error) {
    const summary = error instanceof Error ? error.message.slice(0, 500) : "The run failed.";
    await store.finishRun(run.id, { status: "error", summary });
    return { status: "error" as const, summary, runThreadId };
  }
}
