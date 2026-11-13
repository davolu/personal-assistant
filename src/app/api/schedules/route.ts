import { readThreadMessages, repairBrokenScheduleGoals } from "@/agentic/schedule-repair";
import { ownsThread } from "@/agentic/postgres";
import { postgresScheduleStore } from "@/agentic/schedule-store";
import { contextFromMessages, parseScheduleRequest, toPublicSchedule } from "@/agentic/schedules";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const store = postgresScheduleStore();
  if (!store) return Response.json({ error: "Schedules need a database connection." }, { status: 503 });
  try {
    await repairBrokenScheduleGoals(session.user.id).catch(() => undefined);
    const rows = await store.list(session.user.id);
    return Response.json({ schedules: rows.map(toPublicSchedule) });
  } catch {
    return Response.json({ error: "Schedules are not ready yet." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const zone = requestZone(req);
  const parsed = parseScheduleRequest(body, zone);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  if (!(await ownsThread(session.user.id, parsed.threadId))) return Response.json({ error: "Chat not found" }, { status: 404 });
  const store = postgresScheduleStore();
  if (!store) return Response.json({ error: "Schedules need a database connection." }, { status: 503 });
  const context = contextFromMessages(await readThreadMessages(session.user.id, parsed.threadId));
  try {
    const row = await store.create({
      userId: session.user.id,
      threadId: parsed.threadId,
      draft: parsed.draft,
      context,
    });
    return Response.json({ schedule: toPublicSchedule(row) });
  } catch {
    return Response.json({ error: "Schedules are not ready yet." }, { status: 503 });
  }
}

function requestZone(req: Request): string {
  return req.headers.get("x-timezone") || "UTC";
}
