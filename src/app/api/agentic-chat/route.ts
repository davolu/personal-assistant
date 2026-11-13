import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { Command } from "@langchain/langgraph";
import { getSession } from "@/lib/session";
import { screenInput } from "@/assistant/filters";
import { chooseModel, modelFor } from "@/agentic/model-choice";
import { listModels } from "@/agentic/models";
import { getAgenticGraph, missingModelMessage, threadConfig } from "@/agentic/runtime";
import { readInterrupt } from "@/agentic/graph";
import type { AgenticEvent, AgenticMessage } from "@/agentic/types";
import { inngest } from "@/agentic/inngest";

export const maxDuration = 300;

type Data = {
  thread: { threadId: string };
  todo: { items: { id: string; title: string; status: string }[] };
  ask: { question: string; choices: string[]; options: { label: string; value: string; description?: string }[]; multiSelect: boolean; allowCustom: boolean };
  connect: { app: string; url: string };
  approval: { tool: string; args: Record<string, unknown>; summary: string };
  verify: { score: number; label: string; ungrounded: boolean; feedback: string };
  computer: { streamUrl: string; sandboxId: string };
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const models = listModels();
  const modelId = await modelFor(session.user.id, threadId);
  if (!threadId) {
    const threads = await listFor(session.user.id);
    return Response.json({ threads, models, modelId });
  }
  if (!(await owns(session.user.id, threadId))) return Response.json({ error: "Conversation not found" }, { status: 404 });
  try {
    const { graph } = await getAgenticGraph();
    const snapshot = await graph.getState(threadConfig(threadId));
    return Response.json({ ...viewOf(snapshot.values as Record<string, unknown>, threadId), models, modelId });
  } catch {
    return Response.json({ threadId, messages: [], status: "missing", models, modelId });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (process.env.AGENTIC_CHAT === "0") return Response.json({ error: "Agentic chat is turned off." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role?: string; parts?: { type?: string; text?: string }[]; content?: string }[];
    threadId?: string;
    resume?: Record<string, unknown> | null;
    text?: string;
    modelId?: string;
    modelOnly?: boolean;
  };
  const text = body.text || lastUserText(body.messages ?? []);
  const threadId = body.threadId || (body.modelOnly ? "" : randomUUID());
  if (threadId && !(await owns(session.user.id, threadId))) return Response.json({ error: "Conversation not found" }, { status: 404 });
  const chosen = await chooseModel(session.user.id, threadId || null, body.modelId);
  if (!chosen.ok) return Response.json({ error: chosen.error }, { status: 400 });
  if (body.modelOnly) return Response.json({ modelId: chosen.id });

  if (process.env.AGENTIC_RUNTIME === "inngest") {
    await inngest.send({ name: "agentic/run.requested", data: { threadId, userId: session.user.id, text } });
    await rememberThread(session.user.id, threadId, text);
    return Response.json({ mode: "inngest", threadId, status: "queued" });
  }

  const stream = createUIMessageStream<UIMessage<unknown, Data>>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: randomUUID() });
      writer.write({ type: "start-step" });
      writer.write({ type: "data-thread", data: { threadId } });
      const modelProblem = missingModelMessage();
      if (modelProblem && !body.resume) {
        writeText(writer, modelProblem);
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        return;
      }
      if (!body.resume) {
        const screened = screenInput(text);
        if (!screened.ok) {
          writeText(writer, screened.reason === "empty" ? "Say something to start." : "I can't follow that message.");
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "stop" });
          return;
        }
      }
      const onEvent = (event: AgenticEvent) => {
        if (event.type === "thinking") {
          const id = randomUUID();
          writer.write({ type: "reasoning-start", id });
          writer.write({ type: "reasoning-delta", id, delta: event.text });
          writer.write({ type: "reasoning-end", id });
        } else if (event.type === "tool") {
          writer.write({
            type: "tool-input-available",
            toolCallId: `${event.name}-${event.status}-${event.summary.slice(0, 12)}`,
            toolName: event.name,
            input: { summary: event.summary, status: event.status },
          });
        } else if (event.type === "todo") writer.write({ type: "data-todo", data: { items: event.items } });
        else if (event.type === "ask") writer.write({ type: "data-ask", data: { question: event.question, choices: event.choices, options: event.options, multiSelect: event.multiSelect, allowCustom: event.allowCustom } });
        else if (event.type === "connect") writer.write({ type: "data-connect", data: { app: event.app, url: event.url } });
        else if (event.type === "approval") writer.write({ type: "data-approval", data: { tool: event.tool, args: event.args, summary: event.summary } });
        else if (event.type === "verify") writer.write({ type: "data-verify", data: event });
        else if (event.type === "computer" && event.streamUrl) writer.write({ type: "data-computer", data: { streamUrl: event.streamUrl, sandboxId: event.sandboxId } });
      };
      const { graph } = await getAgenticGraph(onEvent);
      const config = threadConfig(threadId);
      await rememberThread(session.user.id, threadId, text);
      const snapshot = await graph.getState(config).catch(() => null);
      const existing = (snapshot?.values ?? {}) as { messages?: AgenticMessage[]; userId?: string };
      if (existing.userId && existing.userId !== session.user.id) {
        writeText(writer, "That conversation belongs to someone else.");
      } else {
        const paused = snapshot?.tasks?.flatMap((task) => task.interrupts ?? []) ?? [];
        const result = paused.length
          ? await graph.invoke(new Command({ resume: body.resume ?? inferResume(text, paused[0]?.value) }), config)
          : await graph.invoke(
              {
                messages: [...(existing.messages ?? []), { role: "user" as const, content: text }],
                userId: session.user.id,
                goal: text,
                threadId,
                modelId: chosen.id,
                startedAt: Date.now(),
                status: "running",
                toolCalls: 0,
                approaches: [],
                trace: [],
                ledger: [],
                verifyRetries: 0,
                pending: null,
                finalAnswer: "",
              },
              config
            );
        const interrupt = readInterrupt(result);
        const answer = (result as { finalAnswer?: string }).finalAnswer ?? "";
        if (!interrupt && answer) writeText(writer, answer);
      }
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (error) => (error instanceof Error ? error.message.slice(0, 200) : "The agent hit an error."),
  });
  return createUIMessageStreamResponse({ stream, keepAliveMs: 5000 });
}

function writeText(writer: { write: (part: { type: "text-start"; id: string } | { type: "text-delta"; id: string; delta: string } | { type: "text-end"; id: string }) => void }, text: string) {
  const id = randomUUID();
  writer.write({ type: "text-start", id });
  for (const part of chunks(text)) writer.write({ type: "text-delta", id, delta: part });
  writer.write({ type: "text-end", id });
}

function chunks(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 24) parts.push(text.slice(i, i + 24));
  return parts.length ? parts : [""];
}

function lastUserText(messages: { role?: string; parts?: { type?: string; text?: string }[]; content?: string }[]): string {
  const last = [...messages].reverse().find((message) => message.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.parts ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

function inferResume(text: string, value: unknown): Record<string, unknown> {
  const kind = value && typeof value === "object" && "kind" in value ? String((value as { kind?: string }).kind) : "ask";
  if (kind === "approval") {
    if (/^reject/i.test(text)) return { decision: "reject" };
    return { decision: "approve" };
  }
  if (kind === "connect") {
    if (/\b(no|don't|dont|declin|skip|not now)\b/i.test(text)) return { declined: true, connected: false, text };
    return { connected: true, text };
  }
  return { text };
}

function viewOf(values: Record<string, unknown>, threadId: string) {
  const messages = Array.isArray(values.messages) ? values.messages : [];
  return {
    threadId,
    status: values.status ?? "done",
    answer: values.finalAnswer ?? "",
    todos: values.todos ?? [],
    verify: values.verifyScore == null ? null : { score: values.verifyScore, label: values.verifyLabel, ungrounded: values.ungrounded, feedback: values.verifyFeedback },
    computer: values.computerStream ? { streamUrl: values.computerStream, sandboxId: values.sandboxId ?? "" } : null,
    messages: messages.flatMap((message) => {
      const record = message as { role?: string; content?: unknown };
      const text = typeof record.content === "string" ? record.content : textBlocks(record.content);
      if (!text.trim() || text.startsWith("Summary of earlier") || text.startsWith("Verifier:")) return [];
      return [{ role: record.role, text }];
    }),
  };
}

function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
    .map((block) => String((block as { text?: string }).text ?? ""))
    .join("\n");
}

const localThreads = new Map<string, { userId: string; title: string; updatedAt: string }>();

async function rememberThread(userId: string, threadId: string, title: string) {
  localThreads.set(threadId, { userId, title: title.slice(0, 80) || "New chat", updatedAt: new Date().toISOString() });
  try {
    const { ensureThread } = await import("@/agentic/postgres");
    await ensureThread(userId, threadId, title);
  } catch {
    // The in-memory list still lets the page work before the SQL is applied.
  }
}

async function listFor(userId: string) {
  try {
    const { listThreads } = await import("@/agentic/postgres");
    const rows = await listThreads(userId);
    if (rows.length) return rows;
  } catch {
    // Fall through to the process list.
  }
  return [...localThreads.entries()]
    .filter(([, row]) => row.userId === userId)
    .map(([id, row]) => ({ id, title: row.title, updatedAt: row.updatedAt }));
}

async function owns(userId: string, threadId: string) {
  const local = localThreads.get(threadId);
  if (local && local.userId !== userId) return false;
  try {
    const { ownsThread } = await import("@/agentic/postgres");
    return ownsThread(userId, threadId);
  } catch {
    return true;
  }
}
