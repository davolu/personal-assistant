import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { generatePlan } from "@/lib/planner";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { idea } = (await req.json()) as { idea?: string };
  if (!idea || idea.trim().length < 10) {
    return NextResponse.json({ error: "Describe what you want to automate in a sentence or two." }, { status: 400 });
  }

  try {
    const plan = await generatePlan(idea.trim());
    return NextResponse.json({ plan });
  } catch (err) {
    console.error("plan generation error", err);
    return NextResponse.json({ error: "Couldn't draft a plan — try rewording your idea." }, { status: 500 });
  }
}
