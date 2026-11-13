import { getAgenticGraph, threadConfig } from "@/agentic/runtime";
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
  const seeded = await seedFromThread(session.user.id, parsed.threadId, parsed.draft.goal);
  if (!seeded.goal) return Response.json({ error: "This chat needs a goal before it can be scheduled." }, { status: 400 });
  try {
    const row = await store.create({
      userId: session.user.id,
      threadId: parsed.threadId,
      draft: { ...parsed.draft, goal: seeded.goal },
      context: seeded.context,
    });
    return Response.json({ schedule: toPublicSchedule(row) });
  } catch {
    return Response.json({ error: "Schedules are not ready yet." }, { status: 503 });
  }
}

function requestZone(req: Request): string {
  return req.headers.get("x-timezone") || "UTC";
}

async function seedFromThread(userId: string, threadId: string, goal: string): Promise<{ goal: string; context: string }> {
  try {
    const { graph } = await getAgenticGraph();
    const snapshot = await graph.getState(threadConfig(threadId));
    const values = (snapshot.values ?? {}) as { messages?: { role?: string; content?: unknown }[]; userId?: string; goal?: string };
    if (values.userId && values.userId !== userId) return { goal: "", context: "" };
    const messages = values.messages ?? [];
    const context = contextFromMessages(messages);
    const derived = goal || String(values.goal ?? "").trim() || lastUser(messages);
    return { goal: derived.slice(0, 4000), context };
  } catch {
    return { goal, context: "" };
  }
}

function lastUser(messages: { role?: string; content?: unknown }[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const text = typeof message.content === "string" ? message.content : "";
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean && !clean.startsWith("This is a fresh scheduled run")) return clean.slice(0, 4000);
  }
  return "";
}
