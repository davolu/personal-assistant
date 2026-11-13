import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { executeRun } from "@/lib/runner";

export const maxDuration = 300;

const DAY = 20 * 60 * 60 * 1000; // "daily" = at least 20h since last run
const HOUR = 55 * 60 * 1000; // "hourly" = at least 55m since last run

// The scheduler. Call every 10 minutes (Vercel Cron or any scheduler):
//   GET /api/cron/runs  with  Authorization: Bearer <BILLING_CRON_SECRET or CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.BILLING_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  // Approvals are perishable (Ch49): expire stale ones and settle their runs.
  const stale = await prisma.approval.findMany({
    where: { status: "pending", expiresAt: { lt: new Date(now) } },
    select: { id: true, runLogId: true },
  });
  for (const a of stale) {
    await prisma.$transaction([
      prisma.approval.update({ where: { id: a.id }, data: { status: "expired", resolvedAt: new Date() } }),
      prisma.runLog.updateMany({
        where: { id: a.runLogId, status: "waiting" },
        data: { status: "error", stopReason: "WAITING_EXPIRED", finishedAt: new Date() },
      }),
    ]);
  }

  const candidates = await prisma.hiredAgent.findMany({
    where: {
      status: "active",
      schedule: { in: ["daily", "hourly"] },
      OR: [
        { lastRunAt: null },
        { schedule: "daily", lastRunAt: { lte: new Date(now - DAY) } },
        { schedule: "hourly", lastRunAt: { lte: new Date(now - HOUR) } },
      ],
    },
    include: { user: { select: { runsUsed: true, runsQuota: true } } },
    take: 10,
    orderBy: { lastRunAt: { sort: "asc", nulls: "first" } },
  });

  const ran: { agentId: string; logId: string }[] = [];
  for (const agent of candidates) {
    if (agent.user.runsUsed >= agent.user.runsQuota) continue;
    const logId = await executeRun(agent.id, "schedule");
    ran.push({ agentId: agent.id, logId });
    // Agents skipped for missing connections shouldn't be retried every tick —
    // back them off a full cycle.
    const log = await prisma.runLog.findUnique({ where: { id: logId } });
    if (log?.status === "error" && log.summary.startsWith("Run skipped")) {
      await prisma.hiredAgent.update({ where: { id: agent.id }, data: { lastRunAt: new Date() } });
    }
  }

  let chatSchedules = { claimed: 0, ran: 0 };
  try {
    const { runDueChatSchedules } = await import("@/agentic/schedule-runner");
    chatSchedules = await runDueChatSchedules(new Date());
  } catch (error) {
    console.error("[cron] chat schedules", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({ candidates: candidates.length, ran: ran.length, runs: ran, chatSchedules });
}
