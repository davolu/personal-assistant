import { getSession } from "@/lib/session";
import { databaseProblem } from "@/lib/db-error";
import { deleteWorkflow, updateWorkflow } from "@/lib/saved-agents";

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { cadence?: string; paused?: boolean; name?: string };
  try {
    const agent = await updateWorkflow(session.user.id, id, body);
    if (!agent) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ agent });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  try {
    const removed = await deleteWorkflow(session.user.id, id);
    if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
