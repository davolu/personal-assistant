import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { gateChat, performTurn, planningView } from "@/lib/assistant-runtime";
import { databaseProblem } from "@/lib/db-error";
import { screenInput } from "@/assistant/filters";

/** Node route. 60s fits Pro and Hobby; Fluid compute can raise this to 300. */
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const conversationId = new URL(req.url).searchParams.get("conversationId") ?? "";
  if (!conversationId) return Response.json({ error: "Missing conversation" }, { status: 400 });
  const owned = await prisma.conversation.findFirst({ where: { id: conversationId, userId: session.user.id }, select: { id: true } });
  if (!owned) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const task = await prisma.assistantTask.findFirst({
    where: { conversationId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  if (!task) return Response.json({ status: "missing", reply: "", proposal: null, question: null, builderHref: null });
  const planning = await planningView(session.user.id, conversationId);
  const message = await prisma.message.findFirst({
    where: { conversationId, userId: session.user.id, role: "assistant", createdAt: { gte: task.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  return Response.json({
    status: task.status,
    stopReason: task.stopReason,
    reply: task.status === "running" ? "" : message?.content ?? task.summary ?? "",
    proposal: planning.proposal,
    question: planning.question,
    builderHref: planning.builderHref,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; text?: string };
  const text = String(body.text ?? "");
  const screened = screenInput(text);
  if (!screened.ok && screened.reason === "empty") return Response.json({ error: "Empty message" }, { status: 400 });

  const blocked = await gateChat(session.user.id);
  if (blocked) return Response.json({ error: blocked }, { status: 429 });

  let conversationId = body.conversationId ?? "";
  if (conversationId) {
    const owned = await prisma.conversation.findFirst({ where: { id: conversationId, userId: session.user.id } });
    if (!owned) return Response.json({ error: "Conversation not found" }, { status: 404 });
  } else {
    const created = await prisma.conversation.create({ data: { userId: session.user.id } });
    conversationId = created.id;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 5000);
      try {
        send("start", { conversationId });
        send("think", { stage: "gateway", text: "Signed in. Starting the turn." });
        const result = await performTurn({
          userId: session.user.id,
          conversationId,
          text,
          trigger: "chat",
          onEvent: (event) => send(event.type, event),
        });
        for (const part of result.reply.split(/(\s+)/)) {
          if (part) send("token", { text: part });
        }
        if (result.question) send("question", { question: result.question });
        if (result.proposal) send("plan", { proposal: result.proposal });
        if (result.builderHref) send("builder", { href: result.builderHref });
        send("done", { conversationId, stopReason: result.stopReason, approval: result.approval });
      } catch (err) {
        console.error("[assistant] turn failed", err instanceof Error ? err.message.slice(0, 200) : "error");
        send("error", { message: databaseProblem(err) ?? "The assistant hit an error before it could finish." });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may already have gone away.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "x-conversation-id": conversationId,
    },
  });
}
