import { threadConfig } from "./graph";
import { getAgenticGraph } from "./runtime";
import { completeGoalTranscript } from "./schedule-goal-model";
import { repairScheduleRows } from "./schedule-goal";
import { postgresScheduleStore } from "./schedule-store";

export async function repairBrokenScheduleGoals(userId: string | null): Promise<number> {
  const store = postgresScheduleStore();
  if (!store) return 0;
  return repairScheduleRows(store, userId, readThreadMessages, completeGoalTranscript);
}

export async function readThreadMessages(userId: string, threadId: string): Promise<{ role?: string; content?: unknown }[]> {
  try {
    const { graph } = await getAgenticGraph();
    const snapshot = await graph.getState(threadConfig(threadId));
    const values = (snapshot.values ?? {}) as { messages?: { role?: string; content?: unknown }[]; userId?: string };
    if (values.userId && values.userId !== userId) return [];
    return values.messages ?? [];
  } catch {
    return [];
  }
}
