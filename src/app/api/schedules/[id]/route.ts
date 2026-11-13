import { normalizeCadence } from "@/agentic/cadence";
import { SCHEDULE_GOAL_ERROR, validScheduleGoal } from "@/agentic/schedule-goal";
import { postgresScheduleStore, type SchedulePatch } from "@/agentic/schedule-store";
import { toPublicSchedule } from "@/agentic/schedules";
import { getSession } from "@/lib/session";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Choose what to change." }, { status: 400 });
  const store = postgresScheduleStore();
  if (!store) return Response.json({ error: "Schedules need a database connection." }, { status: 503 });
  const patch: SchedulePatch = {};
  if (typeof body.name === "string") {
    const name = body.name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return Response.json({ error: "A schedule needs a name." }, { status: 400 });
    patch.name = name;
  }
  if (body.status === "active" || body.status === "paused") patch.status = body.status;
  if (typeof body.notify === "boolean") patch.notify = body.notify;
  if (typeof body.allowRisky === "boolean") patch.allowRisky = body.allowRisky;
  if ("goal" in body) {
    const goal = validScheduleGoal(body.goal);
    if (!goal) return Response.json({ error: SCHEDULE_GOAL_ERROR }, { status: 400 });
    patch.goal = goal;
  }
  if (body.kind || body.cadence || body.cron || body.time) {
    const cadence = normalizeCadence(body, typeof body.timezone === "string" ? body.timezone : "UTC");
    if (!cadence.ok) return Response.json({ error: cadence.error }, { status: 400 });
    patch.cadence = cadence.cadence;
  }
  try {
    const row = await store.update(session.user.id, id, patch, new Date());
    if (!row) return Response.json({ error: "Schedule not found" }, { status: 404 });
    return Response.json({ schedule: toPublicSchedule(row) });
  } catch {
    return Response.json({ error: "Schedules are not ready yet." }, { status: 503 });
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  const store = postgresScheduleStore();
  if (!store) return Response.json({ error: "Schedules need a database connection." }, { status: 503 });
  try {
    const removed = await store.delete(session.user.id, id);
    if (!removed) return Response.json({ error: "Schedule not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Schedules are not ready yet." }, { status: 503 });
  }
}
