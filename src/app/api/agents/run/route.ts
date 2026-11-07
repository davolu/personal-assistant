import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { executeRun } from "@/lib/runner";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const maxDuration = 120;

// Manual "Run now" from the dashboard.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/signin", appUrl()), 303);

  const form = await req.formData();
  const agentId = String(form.get("agentId") || "");
  const agent = await prisma.hiredAgent.findFirst({
    where: { id: agentId, userId: session.user.id },
  });
  if (!agent) return NextResponse.redirect(new URL("/dashboard", appUrl()), 303);

  await executeRun(agent.id, "manual");
  return NextResponse.redirect(new URL("/dashboard?ran=1", appUrl()), 303);
}
