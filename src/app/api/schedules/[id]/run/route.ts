import { postgresScheduleStore } from "@/agentic/schedule-store";
import { executeScheduleRun, runScheduleNow } from "@/agentic/schedule-runner";
import { getSession } from "@/lib/session";

export const maxDuration = 300;

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  const store = postgresScheduleStore();
  if (!store) return Response.json({ error: "Schedules need a database connection." }, { status: 503 });
  try {
    const schedule = await store.get(session.user.id, id);
    if (!schedule) return Response.json({ error: "Schedule not found" }, { status: 404 });
    const outcome = await runScheduleNow(store, schedule, executeScheduleRun);
    return Response.json(outcome);
  } catch {
    return Response.json({ error: "That run could not start." }, { status: 503 });
  }
}
