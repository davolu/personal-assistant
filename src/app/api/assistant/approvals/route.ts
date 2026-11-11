import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resumeApproval } from "@/lib/assistant-runtime";
import { asRecord } from "@/assistant/util";
import { databaseProblem } from "@/lib/db-error";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
  const approvals = await prisma.assistantApproval.findMany({
    where: { userId: session.user.id, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return Response.json({
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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; decision?: string; args?: unknown };
  if (!body.id || (body.decision !== "approve" && body.decision !== "reject")) {
    return Response.json({ error: "id and decision are required" }, { status: 400 });
  }
  const editedArgs = body.args === undefined ? undefined : asRecord(body.args);
  try {
    const result = await resumeApproval({
      userId: session.user.id,
      approvalId: body.id,
      decision: body.decision,
      editedArgs,
    });
    if (!result) return Response.json({ error: "Approval not found" }, { status: 404 });
    return Response.json({ stopReason: result.stopReason, reply: result.reply });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
