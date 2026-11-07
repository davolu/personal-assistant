import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { executeRun } from "@/lib/runner";

export const maxDuration = 120;

// Manual "Run now" — JSON API consumed by RunNowButton.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { agentId?: string; training?: boolean };
  const agent = await prisma.hiredAgent.findFirst({
    where: { id: body.agentId ?? "", userId: session.user.id },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const logId = await executeRun(agent.id, body.training ? "training" : "manual");
  const log = await prisma.runLog.findUnique({ where: { id: logId } });
  return NextResponse.json({ logId, status: log?.status ?? "error", summary: log?.summary ?? "" });
}
