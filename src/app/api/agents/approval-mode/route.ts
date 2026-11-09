import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { agentId, mode } = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    mode?: string;
  };
  if (mode !== "auto" && mode !== "approve") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const updated = await prisma.hiredAgent.updateMany({
    where: { id: agentId ?? "", userId: session.user.id },
    data: { approvalMode: mode },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ ok: true, mode });
}
