import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { Command } from "@langchain/langgraph";
import { getSession } from "@/lib/session";
import { screenInput } from "@/assistant/filters";
import { chooseModel, modelFor } from "@/agentic/model-choice";
import { listModels } from "@/agentic/models";
import { openMeteredRun } from "@/agentic/run-guard";
import { getAgenticGraph, missingModelMessage, threadConfig } from "@/agentic/runtime";
import { formatCredits, isLowBalance, planKeyOf } from "@/lib/credits";
import { PLANS } from "@/lib/site";
import { balanceOf, ensureUserCredits } from "@/lib/usage-store";
import { readInterrupt } from "@/agentic/graph";
import { HOLD_UPDATE_PREFIX, mergeHolds, planTurn, publicError, resolutionEventName, type GateResolution } from "@/agentic/holds";
import { threadAccess, threadAccessStatus } from "@/agentic/thread-access";
import type { AgenticEvent, AgenticMessage, Hold } from "@/agentic/types";
import { inngest } from "@/agentic/inngest";

export const maxDuration = 300;

type Data = {
  thread: { threadId: string };
  todo: { items: { id: string; title: string; status: string }[] };
  ask: { id: string; question: string; choices: string[]; options: { label: string; value: string; description?: string }[]; multiSelect: boolean; allowCustom: boolean };
  connect: { id: string; app: string; url: string };
  approval: { id: string; tool: string; args: Record<string, unknown>; summary: string };
  hold: Hold;
  verify: { score: number; label: string; ungrounded: boolean; feedback: string };
  computer: { streamUrl: string; sandboxId: string };
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const account = await accountFor(session.user.id);
  const models = listModels(process.env, account.plan);
  const modelId = await modelFor(session.user.id, threadId, process.env, account.plan);
  if (!threadId) {
    const threads = await listFor(session.user.id);
    return Response.json({ threads, models, modelId, credits: account.credits });
  }
  if (!(await owns(session.user.id, threadId))) return Response.json({ error: "Agent not found" }, { status: 404 });
  try {
    const { graph } = await getAgenticGraph();
    const snapshot = await graph.getState(threadConfig(threadId));
    const interrupts = snapshot.tasks?.flatMap((task) => (task.interrupts ?? []).map((item) => item.value)) ?? [];
    const notes = await notesFor(session.user.id, threadId);
    return Response.json({ ...viewOf(snapshot.values as Record<string, unknown>, threadId, interrupts), notes, models, modelId, credits: account.credits });
  } catch {
    return Response.json({ threadId, messages: [], notes: [], status: "missing", models, modelId, credits: account.credits });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (process.env.AGENTIC_CHAT === "0") return Response.json({ error: "Agentic chat is turned off." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role?: string; parts?: { type?: string; text?: string }[]; content?: string }[];
    threadId?: string;
    resume?: (GateResolution & { kind?: string }) | null;
    resolve?: (GateResolution & { kind?: string }) | null;
    text?: string;
    modelId?: string;
    modelOnly?: boolean;
  };
  const text = body.text || lastUserText(body.messages ?? []);
  const threadId = body.threadId || (body.modelOnly ? "" : randomUUID());
  if (threadId && !(await owns(session.user.id, threadId))) return Response.json({ error: "Agent not found" }, { status: 404 });
  const account = await accountFor(session.user.id);
  const chosen = await chooseModel(session.user.id, threadId || null, body.modelId, process.env, account.plan);
  if (!chosen.ok) return Response.json({ error: chosen.error }, { status: 400 });
  if (body.modelOnly) return Response.json({ modelId: chosen.id });

  if (process.env.AGENTIC_RUNTIME === "inngest") {
    const resolving = body.resolve ?? body.resume ?? null;
    try {
      if (resolving) {
        await inngest.send({
          name: resolutionEventName(resolving),
          data: { threadId, userId: session.user.id, ...resolving },
        });
      } else {
        const runId = `chat:${threadId}:${randomUUID()}`;
        const opened = await openMeteredRun(session.user.id, runId, "chat", true);
        if (!opened.ok) return Response.json({ error: opened.message }, { status: 402 });
        await inngest.send({ name: "agentic/run.requested", data: { threadId, userId: session.user.id, text, runId } });
      }
    } catch (error) {
      return Response.json({ error: publicError(error) }, { status: 500 });
    }
    await rememberThread(session.user.id, threadId, text);
    return Response.json({ mode: "inngest", threadId, status: "queued" });
  }

  const stream = createUIMessageStream<UIMessage<unknown, Data>>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: randomUUID() });
      writer.write({ type: "start-step" });
      writer.write({ type: "data-thread", data: { threadId } });
      const resolving = Boolean(body.resolve);
      const modelProblem = missingModelMessage();
      if (modelProblem && !body.resume && !resolving) {
        writeText(writer, modelProblem);
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        return;
      }
      if (!body.resume && !resolving) {
        const screened = screenInput(text);
        if (!screened.ok) {
          writeText(writer, screened.reason === "empty" ? "Say something to start." : "I can't follow that message.");
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "stop" });
          return;
        }
      }
      const runId = `chat:${threadId}:${randomUUID()}`;
      const opened = await openMeteredRun(session.user.id, runId, "chat", !body.resume && !resolving);
      if (!opened.ok) {
        writeText(writer, opened.message);
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        return;
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
        else if (event.type === "ask") writer.write({ type: "data-ask", data: { id: event.id, question: event.question, choices: event.choices, options: event.options, multiSelect: event.multiSelect, allowCustom: event.allowCustom } });
        else if (event.type === "connect") writer.write({ type: "data-connect", data: { id: event.id, app: event.app, url: event.url } });
        else if (event.type === "approval") writer.write({ type: "data-approval", data: { id: event.id, tool: event.tool, args: event.args, summary: event.summary } });
        else if (event.type === "hold") writer.write({ type: "data-hold", data: event.hold });
        else if (event.type === "verify") writer.write({ type: "data-verify", data: event });
        else if (event.type === "computer" && event.streamUrl) writer.write({ type: "data-computer", data: { streamUrl: event.streamUrl, sandboxId: event.sandboxId } });
      };
      try {
      const { graph } = await getAgenticGraph(onEvent, opened.meter);
      const config = threadConfig(threadId);
      await rememberThread(session.user.id, threadId, text);
      const snapshot = await graph.getState(config).catch(() => null);
      const existing = (snapshot?.values ?? {}) as { messages?: AgenticMessage[]; userId?: string };
      if (existing.userId && existing.userId !== session.user.id) {
        writeText(writer, "That conversation belongs to someone else.");
      } else {
        const paused = snapshot?.tasks?.flatMap((task) => task.interrupts ?? []) ?? [];
        const plan = planTurn({ interrupted: paused.length > 0, interruptValue: paused[0]?.value, text, resolve: body.resolve ?? body.resume });
        const result =
          plan.mode === "legacy" || plan.mode === "defer"
            ? await graph.invoke(new Command({ resume: plan.resume }), config)
            : plan.mode === "resolve"
              ? await graph.invoke(
                  { resolution: plan.resolution, finalAnswer: "", status: "running", verifyRetries: 0, toolCalls: 0, modelId: chosen.id, plan: account.plan },
                  config
                )
              : plan.mode === "message"
                ? await graph.invoke(
                    {
                      messages: [...(existing.messages ?? []), { role: "user" as const, content: plan.text }],
                      userId: session.user.id,
                      goal: plan.text,
                      threadId,
                      modelId: chosen.id,
                      plan: account.plan,
                      startedAt: Date.now(),
                      activeMs: 0,
                      touchedAt: Date.now(),
                      status: "running",
                      toolCalls: 0,
                      approaches: [],
                      trace: [],
                      ledger: [],
                      verifyRetries: 0,
                      pending: null,
                      resolution: null,
                      finalAnswer: "",
                    },
                    config
                  )
                : null;
        const interrupt = result ? readInterrupt(result) : null;
        const answer = (result as { finalAnswer?: string } | null)?.finalAnswer ?? "";
        if (result && !interrupt && answer) writeText(writer, answer);
        if (result) {
          try {
            const { recordRunOutcome } = await import("@/agentic/schedule-runner");
            await recordRunOutcome(session.user.id, threadId, result);
          } catch {
            // A chat turn still finishes when schedule bookkeeping is unavailable.
          }
        }
      }
      } finally {
        await opened.release();
      }
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: (error) => publicError(error),
  });
  return createUIMessageStreamResponse({ stream, keepAliveMs: 5000 });
}

async function accountFor(userId: string) {
  const user = await ensureUserCredits(userId);
  const plan = planKeyOf(user?.plan);
  const remaining = user ? balanceOf(user) : 0;
  const allowance = PLANS[plan].credits;
  return {
    plan,
    credits: {
      remaining,
      allowance,
      low: isLowBalance(remaining, allowance),
      label: `${formatCredits(remaining)} credits`,
    },
  };
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

function viewOf(values: Record<string, unknown>, threadId: string, interrupts: unknown[] = []) {
  const messages = Array.isArray(values.messages) ? values.messages : [];
  const visible: { role: unknown; text: string; at: number }[] = [];
  messages.forEach((message, at) => {
    const record = message as { role?: string; content?: unknown };
    const text = typeof record.content === "string" ? record.content : textBlocks(record.content);
    if (!text.trim() || text.startsWith("Summary of earlier") || text.startsWith("Verifier:") || text.startsWith(HOLD_UPDATE_PREFIX)) return;
    visible.push({ role: record.role, text, at });
  });
  const holds = mergeHolds(Array.isArray(values.holds) ? (values.holds as Hold[]) : [], interrupts);
  return {
    threadId,
    status: values.status ?? "done",
    answer: values.finalAnswer ?? "",
    todos: values.todos ?? [],
    holds,
    verify: values.verifyScore == null ? null : { score: values.verifyScore, label: values.verifyLabel, ungrounded: values.ungrounded, feedback: values.verifyFeedback },
    computer: values.computerStream ? { streamUrl: values.computerStream, sandboxId: values.sandboxId ?? "" } : null,
    messages: visible,
  };
}

async function notesFor(userId: string, threadId: string) {
  try {
    const { postgresScheduleStore } = await import("@/agentic/schedule-store");
    const { noteFromRun } = await import("@/agentic/schedules");
    const store = postgresScheduleStore();
    if (!store) return [];
    const runs = await store.listRunsForThread(userId, threadId, 8);
    return runs.flatMap((run) => {
      const note = noteFromRun(run);
      return note ? [note] : [];
    });
  } catch {
    return [];
  }
}

function textBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
    .map((block) => String((block as { text?: string }).text ?? ""))
    .join("\n");
}

const localThreads = new Map<string, { userId: string; title: string; updatedAt: string }>();

async function rememberThread(userId: string, threadId: string, text: string) {
  const existing = localThreads.get(threadId);
  const generated = text.replace(/\s+/g, " ").trim().slice(0, 80);
  const title = existing?.title?.trim() || generated || "New agent";
  localThreads.set(threadId, { userId, title, updatedAt: new Date().toISOString() });
  try {
    const { ensureThread } = await import("@/agentic/postgres");
    await ensureThread(userId, threadId, title);
  } catch {
    // The in-memory list still lets the page work before the SQL is applied.
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { threadId?: string; title?: string; pinned?: boolean; duplicate?: boolean };
  const threadId = String(body.threadId ?? "");
  if (!threadId) return Response.json({ error: "threadId is required" }, { status: 400 });
  const access = await accessFor(session.user.id, threadId);
  if (access !== "allowed") return Response.json({ error: access === "unauthenticated" ? "Sign in first" : "Agent not found" }, { status: threadAccessStatus(access) });
  if (body.duplicate) {
    try {
      const { duplicateThread } = await import("@/agentic/postgres");
      const copy = await duplicateThread(session.user.id, threadId);
      if (!copy) return Response.json({ error: "Agent not found" }, { status: 404 });
      localThreads.set(copy.id, { userId: session.user.id, title: copy.title, updatedAt: new Date().toISOString() });
      return Response.json({ thread: copy });
    } catch {
      return Response.json({ error: "Could not duplicate that agent." }, { status: 500 });
    }
  }
  if (typeof body.pinned === "boolean") {
    try {
      const { setThreadPinned } = await import("@/agentic/postgres");
      const ok = await setThreadPinned(session.user.id, threadId, body.pinned);
      if (!ok) return Response.json({ error: "Agent not found" }, { status: 404 });
    } catch {
      return Response.json({ error: "Could not update that agent." }, { status: 500 });
    }
    return Response.json({ threadId, pinned: body.pinned });
  }
  const title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return Response.json({ error: "threadId and title are required" }, { status: 400 });
  localThreads.set(threadId, { userId: session.user.id, title, updatedAt: new Date().toISOString() });
  try {
    const { renameThread } = await import("@/agentic/postgres");
    await renameThread(session.user.id, threadId, title);
  } catch {
    // The in-memory name still updates when SQL is not applied yet.
  }
  return Response.json({ threadId, title });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const threadId = new URL(req.url).searchParams.get("threadId") || "";
  if (!threadId) return Response.json({ error: "threadId is required" }, { status: 400 });
  const access = await accessFor(session.user.id, threadId);
  if (access !== "allowed") return Response.json({ error: "Agent not found" }, { status: threadAccessStatus(access) });
  const hadLocal = localThreads.delete(threadId);
  let removed = false;
  try {
    const { deleteThread } = await import("@/agentic/postgres");
    removed = await deleteThread(session.user.id, threadId);
  } catch {
    removed = false;
  }
  if (!removed && !hadLocal) return Response.json({ error: "Agent not found" }, { status: 404 });
  return Response.json({ threadId, deleted: true });
}

async function accessFor(userId: string, threadId: string) {
  const local = localThreads.get(threadId);
  let owner = local?.userId ?? null;
  if (!owner) {
    try {
      const { threadOwner } = await import("@/agentic/postgres");
      owner = await threadOwner(threadId);
    } catch {
      owner = null;
    }
  }
  return threadAccess(userId, owner);
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
