import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const ALLOWED = ["daily", "hourly"]; // "event" arrives with realtime triggers

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { agentId, schedule } = (await req.json().catch(() => ({}))) as {
    agentId?: string;
    schedule?: string;
  };
  if (!schedule || !ALLOWED.includes(schedule)) {
    return NextResponse.json({ error: "Invalid schedule" }, { status: 400 });
  }

  const updated = await prisma.hiredAgent.updateMany({
    where: { id: agentId ?? "", userId: session.user.id },
    data: { schedule },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json({ ok: true, schedule });
}
