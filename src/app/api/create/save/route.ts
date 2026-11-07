import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_TOOLKITS } from "@/lib/toolkits";
import type { AgentPlan } from "@/lib/planner";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { plan, visibility } = (await req.json()) as {
    plan?: AgentPlan;
    visibility?: "private" | "public";
  };
  if (!plan?.name || !Array.isArray(plan.toolkits) || plan.toolkits.length === 0) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const toolkits = plan.toolkits.filter((t) => SUPPORTED_TOOLKITS.includes(t));
  if (toolkits.length === 0) {
    return NextResponse.json({ error: "Plan uses no supported tools" }, { status: 400 });
  }

  const custom = await prisma.customAgent.create({
    data: {
      userId: session.user.id,
      name: plan.name.slice(0, 80),
      description: plan.description.slice(0, 500),
      instructions: plan.instructions.slice(0, 4000),
      toolkits,
      steps: plan.steps.slice(0, 8),
      schedule: ["daily", "hourly", "event"].includes(plan.schedule) ? plan.schedule : "daily",
      visibility: visibility === "public" ? "public" : "private",
    },
  });

  // Custom agents live in the same dashboard/run system as template agents.
  await prisma.hiredAgent.create({
    data: {
      userId: session.user.id,
      slug: `custom-${custom.id}`,
      name: custom.name,
      tier: "standard",
      schedule: custom.schedule,
    },
  });

  return NextResponse.json({ id: custom.id, connect: `/connect/custom-${custom.id}?hired=1` });
}
