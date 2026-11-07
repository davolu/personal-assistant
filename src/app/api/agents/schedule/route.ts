import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { agentToolkits, eventToolkitsOf, subscribeEventTriggers } from "@/lib/triggers";

const ALLOWED = ["daily", "hourly", "event"];

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

  const agent = await prisma.hiredAgent.findFirst({
    where: { id: agentId ?? "", userId: session.user.id },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  if (schedule === "event") {
    const toolkits = await agentToolkits(agent);
    if (eventToolkitsOf(toolkits).length === 0) {
      return NextResponse.json(
        { error: "None of this agent's apps support real-time events yet." },
        { status: 400 }
      );
    }
    let subscribed: string[];
    try {
      subscribed = await subscribeEventTriggers(session.user.id, toolkits);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not enable the event trigger." },
        { status: 502 }
      );
    }
    if (subscribed.length === 0) {
      return NextResponse.json(
        { error: "Connect the app first — events need an active connection." },
        { status: 400 }
      );
    }
  }

  await prisma.hiredAgent.update({ where: { id: agent.id }, data: { schedule } });
  return NextResponse.json({ ok: true, schedule });
}
