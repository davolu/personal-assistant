import { NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { executeRun, type RunEvent } from "@/lib/runner";

export const maxDuration = 120;

// Streams run progress as NDJSON — one JSON event per line.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "Sign in first" }), { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { agentId?: string; training?: boolean; attempt?: number };
  const agent = await prisma.hiredAgent.findFirst({
    where: { id: body.agentId ?? "", userId: session.user.id },
  });
  if (!agent) return new Response(JSON.stringify({ error: "Agent not found" }), { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          /* client disconnected — run continues server-side */
        }
      };
      try {
        await executeRun(agent.id, body.training ? "training" : "manual", send, Math.max(1, Math.min(5, body.attempt ?? 1)));
      } catch (err) {
        send({
          type: "finish",
          status: "error",
          summary: err instanceof Error ? err.message : String(err),
          logId: "",
        });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
