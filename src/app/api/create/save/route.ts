import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_TOOLKITS } from "@/lib/toolkits";
import type { AgentPlan } from "@/lib/planner";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { plan, visibility, idea, editId } = (await req.json()) as {
    plan?: AgentPlan;
    visibility?: "private" | "public";
    idea?: string;
    editId?: string;
  };
  if (!plan?.name || !Array.isArray(plan.toolkits) || plan.toolkits.length === 0) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const toolkits = plan.toolkits.filter((t) => SUPPORTED_TOOLKITS.includes(t));
  if (toolkits.length === 0) {
    return NextResponse.json({ error: "Plan uses no supported tools" }, { status: 400 });
  }

  // The exact tool sequence from plan grounding becomes part of the runtime
  // playbook — the agent follows it literally instead of improvising a path.
  const procedureText =
    Array.isArray(plan.procedure) && plan.procedure.length > 0
      ? `\n\nTool procedure — execute these operations in this exact order, passing each step's output into the next:\n${plan.procedure
          .map((p, i) => `${i + 1}. ${p.tool} — ${p.purpose}`)
          .join("\n")}`
      : "";

  const data = {
    name: plan.name.slice(0, 80),
    description: plan.description.slice(0, 500),
    idea: (idea ?? "").slice(0, 2000),
    instructions: `${plan.instructions}${procedureText}`.slice(0, 6000),
    toolkits,
    steps: plan.steps.slice(0, 8),
    schedule: ["daily", "hourly", "event"].includes(plan.schedule) ? plan.schedule : "daily",
    visibility: visibility === "public" ? "public" : "private",
  };

  // Editing an existing custom agent: regenerate its definition in place.
  if (editId) {
    const existing = await prisma.customAgent.findFirst({
      where: { id: editId, userId: session.user.id },
    });
    if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    await prisma.$transaction([
      prisma.customAgent.update({ where: { id: existing.id }, data }),
      prisma.hiredAgent.updateMany({
        where: { userId: session.user.id, slug: `custom-${existing.id}` },
        data: { name: data.name, schedule: data.schedule, status: "draft" }, // re-train after edits
      }),
    ]);
    return NextResponse.json({ id: existing.id, connect: `/connect/custom-${existing.id}` });
  }

  const custom = await prisma.customAgent.create({ data: { ...data, userId: session.user.id } });
  await prisma.hiredAgent.create({
    data: {
      userId: session.user.id,
      slug: `custom-${custom.id}`,
      name: custom.name,
      tier: "standard",
      schedule: custom.schedule,
      status: "draft", // goes live only after training succeeds
    },
  });

  return NextResponse.json({ id: custom.id, connect: `/connect/custom-${custom.id}?hired=1` });
}
