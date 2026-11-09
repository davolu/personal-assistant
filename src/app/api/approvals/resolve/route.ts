import { NextRequest, NextResponse } from "next/server";
import { Composio } from "@composio/core";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

// Replay a stored tool call through the same Composio path the runner uses.
async function executeStoredCall(userId: string, tool: string, args: string) {
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const fake = {
    id: "approval-replay",
    object: "chat.completion" as const,
    created: 0,
    model: "approval-replay",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls" as const,
        logprobs: null,
        message: {
          role: "assistant" as const,
          content: null,
          refusal: null,
          tool_calls: [
            { id: "call_approval", type: "function" as const, function: { name: tool, arguments: args } },
          ],
        },
      },
    ],
  };
  const results = (await composio.provider.handleToolCalls(userId, fake)) as {
    content?: string;
  }[];
  const content = typeof results?.[0]?.content === "string" ? results[0].content : "";
  let ok = content.length > 0;
  try {
    const parsed = JSON.parse(content);
    ok = parsed?.successful !== false && !parsed?.error;
  } catch {
    /* non-JSON result — treat presence as success */
  }
  return { ok, content: content.slice(0, 2000) };
}

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

  const approval = await prisma.approval.findFirst({
    where: { id: approvalId ?? "", userId: session.user.id },
    include: { agent: true },
  });
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (approval.status !== "pending") {
    return NextResponse.json({ error: "Already resolved" }, { status: 409 });
  }

  if (action === "approve") {
    const exec = await executeStoredCall(approval.userId, approval.tool, approval.args);
    if (!exec.ok) {
      return NextResponse.json(
        { error: `Execution failed: ${exec.content.slice(0, 200) || "unknown error"}. The approval stays pending — try again.` },
        { status: 502 }
      );
    }
    await prisma.approval.update({
      where: { id: approval.id },
      data: { status: "approved", result: exec.content, resolvedAt: new Date() },
    });
  } else {
    await prisma.approval.update({
      where: { id: approval.id },
      data: { status: "rejected", result: (reason ?? "").slice(0, 500), resolvedAt: new Date() },
    });
    // The agent learns the owner's taste from rejections.
    if (reason) {
      const memory = `${approval.agent.memory}\n- Owner rejected ${approval.tool}: ${reason.slice(0, 160)}`.slice(0, 2500);
      await prisma.hiredAgent.update({ where: { id: approval.agentId }, data: { memory } });
    }
  }

  // When the run's last pending approval is resolved, settle the run status.
  const stillPending = await prisma.approval.count({
    where: { runLogId: approval.runLogId, status: "pending" },
  });
  if (stillPending === 0) {
    const anyApproved = await prisma.approval.count({
      where: { runLogId: approval.runLogId, status: "approved" },
    });
    const run = await prisma.runLog.findUnique({ where: { id: approval.runLogId } });
    if (run && run.status === "waiting") {
      await prisma.runLog.update({
        where: { id: run.id },
        data: {
          status: anyApproved > 0 ? "success" : "rejected",
          summary: `${run.summary}\n\n${anyApproved > 0 ? "✓ Approved by you — action(s) executed." : "✗ You rejected the prepared action(s)."}`.slice(0, 2000),
        },
      });
    }
  }

  return NextResponse.json({ ok: true, action });
}
