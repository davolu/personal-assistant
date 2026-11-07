import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { agentId } = (await req.json()) as { agentId?: string };
  const agent = await prisma.hiredAgent.findFirst({
    where: { id: agentId ?? "", userId: session.user.id },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  // Deleting the HiredAgent cascades its run logs. Custom agents also drop their definition.
  await prisma.hiredAgent.delete({ where: { id: agent.id } });
  if (agent.slug.startsWith("custom-")) {
    await prisma.customAgent.deleteMany({
      where: { id: agent.slug.replace(/^custom-/, ""), userId: session.user.id },
    });
  }

  return NextResponse.json({ ok: true });
}
