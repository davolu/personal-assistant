import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { databaseProblem } from "@/lib/db-error";
import { asStored, rememberRun, workflowRunText } from "@/lib/saved-agents";
import { performTurn } from "@/lib/assistant-runtime";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await context.params;
  try {
    const row = await prisma.customAgent.findFirst({ where: { id, userId: session.user.id } });
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    const stored = asStored(row.procedure);
    const text = stored ? workflowRunText(row.id, stored) : row.instructions;
    const conversation = await prisma.conversation.create({ data: { userId: session.user.id, title: row.name.slice(0, 80) } });
    const result = await performTurn({
      userId: session.user.id,
      conversationId: conversation.id,
      text,
      trigger: "schedule",
      preapprovedExternal: stored?.externalApproved === true,
    });
    await rememberRun(session.user.id, row.id, result.stopReason);
    return Response.json({
      stopReason: result.stopReason,
      reply: result.reply.slice(0, 500),
      tools: result.trace.map((entry) => entry.tool),
    });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
