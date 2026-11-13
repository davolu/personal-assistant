import { readThreadMessages } from "@/agentic/schedule-repair";
import { goalForChat } from "@/agentic/schedule-goal-model";
import { SCHEDULE_GOAL_ERROR } from "@/agentic/schedule-goal";
import { ownsThread } from "@/agentic/postgres";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { threadId?: unknown } | null;
  const threadId = typeof body?.threadId === "string" ? body.threadId.trim() : "";
  if (!threadId) return Response.json({ error: "Open a chat before saving a schedule." }, { status: 400 });
  if (!(await ownsThread(session.user.id, threadId))) return Response.json({ error: "Chat not found" }, { status: 404 });
  const messages = await readThreadMessages(session.user.id, threadId);
  const goal = await goalForChat(session.user.id, threadId, messages);
  if (!goal) return Response.json({ error: SCHEDULE_GOAL_ERROR }, { status: 400 });
  return Response.json({ goal });
}
