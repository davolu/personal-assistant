import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { resumeFromApproval } from "@/lib/runner";

// Resuming a run can walk several more steps — allow time for it.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { approvalId, action, reason } = (await req.json().catch(() => ({}))) as {
    approvalId?: string;
    action?: string;
    reason?: string;
  };
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "approve") {
    // Executes the exact held call, then resumes the checkpointed run (Ch49, Ch23).
    const result = await resumeFromApproval(approvalId ?? "", session.user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, action });
  }

  // Reject: no effect, the agent learns the owner's taste from the reason.
  const approval = await prisma.approval.findFirst({
    where: { id: approvalId ?? "", userId: session.user.id },
    include: { agent: true },
  });
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (approval.status !== "pending") {
    return NextResponse.json({ error: "Already resolved" }, { status: 409 });
  }

  await prisma.approval.update({
    where: { id: approval.id },
    data: { status: "rejected", result: (reason ?? "").slice(0, 500), resolvedAt: new Date() },
  });
  if (reason) {
    const memory = `${approval.agent.memory}\n- Owner rejected ${approval.tool}: ${reason.slice(0, 160)}`.slice(0, 2500);
    await prisma.hiredAgent.update({ where: { id: approval.agentId }, data: { memory } });
  }

  const stillPending = await prisma.approval.count({
    where: { runLogId: approval.runLogId, status: "pending" },
  });
  if (stillPending === 0) {
    const run = await prisma.runLog.findUnique({ where: { id: approval.runLogId } });
    if (run && run.status === "waiting") {
      const anyApproved = await prisma.approval.count({
        where: { runLogId: approval.runLogId, status: "approved" },
      });
      await prisma.runLog.update({
        where: { id: run.id },
        data: {
          status: anyApproved > 0 ? "success" : "rejected",
          stopReason: anyApproved > 0 ? "DONE" : "DENIED",
          summary: `${run.summary}\n\n${anyApproved > 0 ? "✓ Approved actions executed." : "✗ You rejected the prepared action."}`.slice(0, 2000),
          finishedAt: new Date(),
        },
      });
    }
  }

  return NextResponse.json({ ok: true, action });
}
