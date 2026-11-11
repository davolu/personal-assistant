import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { performTurn } from "@/lib/assistant-runtime";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; text?: string };
  const text = String(body.text ?? "");
  if (!text.trim()) return Response.json({ error: "Empty message" }, { status: 400 });

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
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
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
        send("done", { conversationId, stopReason: result.stopReason, approval: result.approval });
      } catch (err) {
        console.error("[assistant] turn failed", err instanceof Error ? err.message.slice(0, 200) : "error");
        send("error", { message: "The assistant hit an error before it could finish." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
