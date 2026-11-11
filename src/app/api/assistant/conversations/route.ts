import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { databaseProblem } from "@/lib/db-error";
import { planningView } from "@/lib/assistant-runtime";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, updatedAt: true },
  });
  return Response.json({ conversations });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      const created = await prisma.conversation.create({ data: { userId: session.user.id } });
      return Response.json({ conversation: { id: created.id, title: created.title, messages: [] } });
    }
    const conversation = await prisma.conversation.findFirst({ where: { id, userId: session.user.id } });
    if (!conversation) return Response.json({ error: "Conversation not found" }, { status: 404 });
    const messages = await prisma.message.findMany({
      where: { conversationId: id, userId: session.user.id },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, role: true, content: true },
    });
    const approvals = await prisma.assistantApproval.findMany({
      where: { userId: session.user.id, status: "pending", task: { conversationId: id } },
      orderBy: { createdAt: "desc" },
    });
    const planning = await planningView(session.user.id, id);
    return Response.json({
      conversation: { id: conversation.id, title: conversation.title, messages },
      ...planning,
      approvals: approvals.map((approval) => ({
        id: approval.id,
        tool: approval.tool,
        args: approval.args,
        expiresAt: approval.expiresAt,
      })),
    });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
