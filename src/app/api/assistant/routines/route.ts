import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { nextRunAt } from "@/assistant/scheduler";
import { databaseProblem } from "@/lib/db-error";

const CADENCE = new Set(["hourly", "daily", "weekly", "event"]);

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    const routines = await prisma.routine.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return Response.json({ routines });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; cadence?: string; prompt?: string; toolkit?: string };
  const cadence = String(body.cadence ?? "");
  const prompt = String(body.prompt ?? "").trim();
  if (!CADENCE.has(cadence) || !prompt) return Response.json({ error: "cadence and prompt are required" }, { status: 400 });
  if (cadence === "event" && !String(body.toolkit ?? "").trim()) {
    return Response.json({ error: "An event routine needs a toolkit name, such as Gmail" }, { status: 400 });
  }
  try {
    const routine = await prisma.routine.create({
      data: {
        userId: session.user.id,
        name: String(body.name ?? prompt).slice(0, 80),
        cadence,
        prompt: prompt.slice(0, 2000),
        toolkit: String(body.toolkit ?? "").slice(0, 80),
        nextRunAt: nextRunAt(cadence, new Date()),
      },
    });
    return Response.json({ routine });
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
}
