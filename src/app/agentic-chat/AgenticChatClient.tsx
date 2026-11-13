"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { parseAskInput } from "@/agentic/ask";
import { listModels } from "@/agentic/models";
import type { RunNote } from "@/agentic/schedules";
import type { AskOption } from "@/agentic/types";
import { DesktopPanel } from "@/components/DesktopPanel";
import { validScheduleGoal } from "@/agentic/schedule-goal";
import { SchedulePicker, emptyDraft, type ScheduleDraftInput } from "@/components/SchedulePicker";
import { AgentList, type AgentThread } from "./agent-list";
import { ApprovalCard, AskOptionCards, Composer, ConnectCard, MessageList, ModelPicker, SidePanels, TypingIndicator, type PublicModelCard } from "./chat-ui";

type AskData = {
  question: string;
  choices: string[];
  options: AskOption[];
  multiSelect: boolean;
  allowCustom: boolean;
};

type Data = {
  thread: { threadId: string };
  todo: { items: TodoItem[] };
  ask: AskData & { id?: string };
  connect: { id?: string; app: string; url: string };
  approval: { id?: string; tool: string; args: Record<string, unknown>; summary: string };
  hold: { id: string; status: "pending" | "resolved"; error?: string; resolution?: { label: string; selected?: string[] } };
  verify: { score: number; label: string; ungrounded: boolean; feedback: string };
  computer: { streamUrl: string; sandboxId: string };
};

type AgenticMessage = UIMessage<{ at?: number }, Data>;
type TodoItem = { id: string; title: string; status: string };
type Thread = AgentThread;

export type AgenticChatViewProps = {
  threads: Thread[];
  signedOut: boolean;
  messages: AgenticMessage[];
  ask: Data["ask"] | null;
  approval: Data["approval"] | null;
  connects: Data["connect"][];
  todos: TodoItem[];
  verify: Data["verify"] | null;
  computer: Data["computer"] | null;
  computerOpen: boolean;
  draft: string;
  editArgs: string;
  busy: boolean;
  error: string | null;
  pendingText?: string | null;
  keyboardInset: number;
  scrollerRef?: Ref<HTMLDivElement>;
  onScroll?: () => void;
  onNewChat: () => void;
  onOpenThread: (id: string) => void;
  activeId?: string | null;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onDuplicate?: (id: string) => void;
  onSchedule?: (id: string) => void;
  picker?: ReactNode;
  notes?: RunNote[];
  notice?: string | null;
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onToggleComputer: () => void;
  onEditArgs: (value: string) => void;
  title?: string;
  resolvingId?: string | null;
  settled?: Record<string, { status: "pending" | "resolved"; label?: string; selected?: string[]; error?: string }>;
  onApprove: (id?: string) => void;
  onEditApproval: (id?: string) => void;
  onReject: (id?: string) => void;
  onAnswerAsk?: (id: string | undefined, text: string, selected?: string[]) => void;
  onConnected?: (id: string | undefined, app: string) => void;
  loadedHolds?: LoadedHold[];
  onStop?: () => void;
  models?: PublicModelCard[];
  modelId?: string | null;
  onModel?: (id: string) => void;
};

export default function AgenticChatClient() {
  const threadRef = useRef<string | null>(null);
  const resumeRef = useRef<Record<string, unknown> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [computerOpen, setComputerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editArgs, setEditArgs] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [settled, setSettled] = useState<Record<string, { status: "pending" | "resolved"; label?: string; selected?: string[]; error?: string }>>({});
  const [loadedHolds, setLoadedHolds] = useState<LoadedHold[]>([]);
  const resolvingRef = useRef<string | null>(null);
  const [models, setModels] = useState<PublicModelCard[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [notes, setNotes] = useState<RunNote[]>([]);
  const [picker, setPicker] = useState<ScheduleDraftInput | null>(null);
  const [pickerThread, setPickerThread] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [goalSuggestion, setGoalSuggestion] = useState("");
  const [goalLoading, setGoalLoading] = useState(false);
  const goalToken = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const modelRef = useRef<string | null>(null);
  const pinned = useRef(true);
  const keyboardInset = useKeyboardInset();
  const preview = usePreviewMode();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgenticMessage>({
        api: "/api/agentic-chat",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const resume = resumeRef.current;
          resumeRef.current = null;
          return { body: { ...body, messages, threadId: threadRef.current, resume, modelId: modelRef.current } };
        },
      }),
    []
  );

  const { messages, sendMessage, status, error, setMessages, stop } = useChat<AgenticMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";
  const ask = latest(messages, "data-ask");
  const approval = latest(messages, "data-approval");
  const connects = all(messages, "data-connect");
  const todos = latest(messages, "data-todo")?.items ?? [];
  const verify = latest(messages, "data-verify");
  const computer = latest(messages, "data-computer");

  useEffect(() => {
    const found = latest(messages, "data-thread");
    if (found?.threadId) {
      threadRef.current = found.threadId;
      setActiveId(found.threadId);
    }
  }, [messages]);

  useEffect(() => {
    if (approval) setEditArgs(JSON.stringify(approval.args, null, 2));
  }, [approval]);

  useEffect(() => {
    void fetch("/api/agentic-chat")
      .then(async (res) => {
        if (res.status === 401) {
          setSignedOut(true);
          return;
        }
        const json = (await res.json()) as { threads?: Thread[]; models?: PublicModelCard[]; modelId?: string | null };
        setThreads(json.threads ?? []);
        setModels(json.models ?? []);
        setModelId((current) => current ?? json.modelId ?? null);
        if (!modelRef.current && json.modelId) modelRef.current = json.modelId;
      })
      .catch(() => undefined);
  }, [busy]);

  useEffect(() => {
    if (!pendingText) return;
    if (lastUserText(messages) === pendingText || error) setPendingText(null);
  }, [messages, pendingText, error]);

  useEffect(() => {
    const url = computer?.streamUrl;
    if (!url) return;
    setComputerOpen(true);
  }, [computer?.streamUrl]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !pinned.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pendingText, busy, ask, approval]);

  async function deleteAgent(id: string) {
    const res = await fetch(`/api/agentic-chat?threadId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return;
    setThreads((current) => current.filter((thread) => thread.id !== id));
    setLoadedHolds([]);
    if (threadRef.current === id) {
      threadRef.current = null;
      setActiveId(null);
      setMessages([]);
    }
  }

  async function pinAgent(id: string, pinned: boolean) {
    const res = await fetch("/api/agentic-chat", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: id, pinned }),
    });
    if (!res.ok) return;
    setThreads((current) => {
      const next = current.map((thread) => (thread.id === id ? { ...thread, pinned } : thread));
      return [...next.filter((thread) => thread.pinned), ...next.filter((thread) => !thread.pinned)];
    });
  }

  async function duplicateAgent(id: string) {
    const res = await fetch("/api/agentic-chat", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: id, duplicate: true }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { thread?: Thread };
    if (!json.thread) return;
    setThreads((current) => [json.thread!, ...current]);
  }

  async function renameAgent(id: string, raw: string) {
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!title) return;
    const res = await fetch("/api/agentic-chat", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: id, title }),
    });
    if (!res.ok) return;
    setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, title } : thread)));
  }

  async function openThread(id: string) {
    threadRef.current = id;
    setActiveId(id);
    const res = await fetch(`/api/agentic-chat?threadId=${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const json = (await res.json()) as { messages?: { role: string; text: string; at?: number }[]; holds?: LoadedHold[]; notes?: RunNote[] };
    setLoadedHolds(json.holds ?? []);
    setNotes(json.notes ?? []);
    setSettled(Object.fromEntries((json.holds ?? []).map((hold) => [hold.id, { status: hold.status, label: hold.resolution?.label, selected: hold.resolution?.selected, error: hold.error }])));
    setMessages(
      (json.messages ?? []).map((message, index) => ({
        id: `${id}-${message.at ?? index}`,
        role: message.role as "user" | "assistant",
        metadata: { at: message.at ?? index },
        parts: [{ type: "text" as const, text: message.text }],
      }))
    );
  }

  function setCardError(id: string, error: string) {
    if (!id) return;
    setSettled((current) => ({ ...current, [id]: { status: "pending", error } }));
  }

  async function resolveCard(body: { id?: string; decision?: string; text?: string; args?: Record<string, unknown>; selected?: string[]; connected?: boolean }) {
    const id = body.id || "";
    if (!id || resolvingRef.current) return;
    resolvingRef.current = id;
    setResolvingId(id);
    setSettled((current) => ({ ...current, [id]: { ...current[id], status: "pending", error: undefined } }));
    try {
      const res = await fetch("/api/agentic-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: threadRef.current, resolve: body, modelId: modelRef.current }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setCardError(id, json.error || "That could not be completed. It is still waiting, so you can try again.");
        return;
      }
      const label = body.decision === "approve" ? "Approved" : body.decision === "edit" ? "Edited and approved" : body.decision === "reject" ? "Rejected" : body.decision === "connect" ? "Connected" : body.text || body.decision || "Answered";
      let assistant = "";
      let failed = false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
          if (!payload || payload === "[DONE]") continue;
          const event = JSON.parse(payload) as { type?: string; delta?: string; data?: Data["hold"]; errorText?: string };
          if (event.type === "text-delta" && event.delta) assistant += event.delta;
          if (event.type === "data-hold" && event.data?.id) {
            const hold = event.data;
            if (hold.status === "pending" && hold.error) failed = true;
            setSettled((current) => ({
              ...current,
              [hold.id]: {
                status: hold.status,
                label: hold.resolution?.label,
                selected: hold.resolution?.selected,
                error: hold.error,
              },
            }));
          }
          if (event.type === "error") throw new Error(event.errorText || "That could not be completed. It is still waiting, so you can try again.");
        }
      }
      if (!failed) setSettled((current) => ({ ...current, [id]: { status: "resolved", label, selected: body.selected, error: undefined } }));
      if (assistant.trim()) {
        setMessages((current) => [
          ...current,
          { id: `reply-${id}-${current.length}`, role: "assistant", parts: [{ type: "text", text: assistant }] },
        ]);
      }
    } catch (error) {
      setCardError(id, error instanceof Error ? error.message : "That could not be completed. It is still waiting, so you can try again.");
    } finally {
      resolvingRef.current = null;
      setResolvingId(null);
    }
  }

  function openSchedule(id: string | null, name: string) {
    const token = ++goalToken.current;
    setPickerError(null);
    setPickerThread(id);
    setGoalSuggestion("");
    setPicker(emptyDraft(name || "Scheduled agent"));
    if (!id || id.startsWith("preview") || preview) {
      setGoalLoading(false);
      return;
    }
    setGoalLoading(true);
    void fetch("/api/schedules/goal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: id }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { goal?: string };
        if (goalToken.current !== token || !res.ok || !json.goal) return;
        setGoalSuggestion(json.goal);
      })
      .catch(() => undefined)
      .finally(() => {
        if (goalToken.current === token) setGoalLoading(false);
      });
  }

  async function saveSchedule(draft: ScheduleDraftInput) {
    const threadId = pickerThread || threadRef.current;
    if (preview) {
      setNotice(`Saved “${draft.name || "this chat"}”. It will show on Schedule.`);
      setPicker(null);
      return;
    }
    if (!threadId) {
      setPickerError("Send a message first so this chat has a goal.");
      return;
    }
    if (!validScheduleGoal(draft.goal)) {
      setPickerError("Say what this should do each run.");
      return;
    }
    setPickerBusy(true);
    setPickerError(null);
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "content-type": "application/json", "x-timezone": draft.timezone },
      body: JSON.stringify({
        threadId,
        name: draft.name,
        goal: draft.goal,
        kind: draft.kind,
        time: draft.time,
        weekday: draft.weekday,
        hours: draft.hours,
        cron: draft.cron,
        timezone: draft.timezone,
        notify: draft.notify,
        allowRisky: draft.allowRisky,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; schedule?: { nextRunAt?: string | null } };
    setPickerBusy(false);
    if (!res.ok) {
      setPickerError(json.error || "Could not save that schedule");
      return;
    }
    const when = json.schedule?.nextRunAt
      ? new Date(json.schedule.nextRunAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: draft.timezone })
      : "soon";
    setNotice(`Saved “${draft.name}”. Next run ${when}.`);
    setPicker(null);
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || preview) return;
    setDraft("");
    setPendingText(trimmed);
    pinned.current = true;
    void sendMessage({ text: trimmed });
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const thread = params.get("thread");
    if (thread) void openThread(thread);
    if (params.get("preview") === "schedule") openSchedule("preview-friday", "Friday recap");
  }, []);

  const showAsk = preview === "ask" && messages.length === 0;
  const showFormat = preview === "format" && messages.length === 0;
  const showAgents = preview === "agents" || preview === "schedule";
  return (
    <AgenticChatView
      threads={showAgents ? PREVIEW_THREADS : threads}
      signedOut={signedOut && !preview}
      messages={showAsk ? PREVIEW_MESSAGES : showFormat ? FORMAT_MESSAGES : messages}
      ask={showAsk ? PREVIEW_ASK : ask}
      approval={showAsk ? PREVIEW_APPROVAL : approval}
      connects={showAsk ? PREVIEW_CONNECTS : connects}
      todos={showAsk || showFormat ? PREVIEW_TODOS : todos}
      verify={verify}
      computer={computer}
      computerOpen={computerOpen}
      draft={draft}
      editArgs={editArgs}
      busy={busy}
      error={error?.message ?? null}
      pendingText={preview ? null : pendingText}
      keyboardInset={keyboardInset}
      scrollerRef={scroller}
      onScroll={() => {
        const node = scroller.current;
        if (!node) return;
        pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
      onNewChat={() => {
        threadRef.current = null;
        setActiveId(null);
        setLoadedHolds([]);
        setSettled({});
        setMessages([]);
        setNotes([]);
        setNotice(null);
      }}
      onOpenThread={(id) => void openThread(id)}
      onSchedule={(id) => {
        const threadId = id || threadRef.current;
        if (threadId && !threadId.startsWith("preview")) void openThread(threadId);
        const list = showAgents ? PREVIEW_THREADS : threads;
        openSchedule(threadId, list.find((thread) => thread.id === threadId)?.title || "Scheduled agent");
      }}
      notes={notes}
      notice={notice}
      picker={picker ? <SchedulePicker key={pickerThread ?? "new"} initial={picker} goalSuggestion={goalSuggestion} goalLoading={goalLoading} busy={pickerBusy} error={pickerError} onClose={() => setPicker(null)} onSave={(draft) => void saveSchedule(draft)} /> : null}
      activeId={showAgents ? "preview-friday" : activeId}
      onRename={(id, title) => void renameAgent(id, title)}
      onDelete={(id) => void deleteAgent(id)}
      onPin={(id, pinned) => void pinAgent(id, pinned)}
      onDuplicate={(id) => void duplicateAgent(id)}
      onDraft={setDraft}
      onSubmit={submit}
      onToggleComputer={() => setComputerOpen((value) => !value)}
      onEditArgs={setEditArgs}
      title={(threads.find((thread) => thread.id === activeId)?.title || "").trim() || "Autonomous Agent"}
      resolvingId={resolvingId}
      settled={settled}
      loadedHolds={loadedHolds}
      onApprove={(id) => void resolveCard({ id: id || approval?.id, decision: "approve" })}
      onEditApproval={(id) => {
        try {
          void resolveCard({ id: id || approval?.id, decision: "edit", args: JSON.parse(editArgs) as Record<string, unknown> });
        } catch {
          setCardError(id || approval?.id || "", "The edited JSON is not valid. It is still waiting, so you can try again.");
        }
      }}
      onReject={(id) => void resolveCard({ id: id || approval?.id, decision: "reject" })}
      onAnswerAsk={(id, text, selected) => void resolveCard({ id, decision: text, text, selected })}
      onConnected={(id, app) => void resolveCard({ id, decision: "connect", connected: true, text: app })}
      models={preview && models.length === 0 ? PREVIEW_MODELS : models}
      modelId={preview && !modelId ? "claude-sonnet-5-5" : modelId}
      onStop={() => stop()}
      onModel={(id) => {
        modelRef.current = id;
        setModelId(id);
        if (preview) return;
        void fetch("/api/agentic-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ modelOnly: true, modelId: id, threadId: threadRef.current }),
        });
      }}
    />
  );
}

export function AgenticChatView({
  threads,
  signedOut,
  messages,
  ask,
  approval,
  connects,
  todos,
  verify,
  computer,
  computerOpen,
  draft,
  editArgs,
  busy,
  error,
  pendingText = null,
  keyboardInset,
  scrollerRef,
  onScroll,
  onNewChat,
  onOpenThread,
  activeId = null,
  onRename,
  onDelete,
  onPin,
  onDuplicate,
  onSchedule,
  picker = null,
  notes = [],
  notice = null,
  onDraft,
  onSubmit,
  onToggleComputer,
  onEditArgs,
  onApprove,
  onEditApproval,
  onReject,
  onAnswerAsk,
  onConnected,
  title = "Autonomous Agent",
  resolvingId = null,
  settled = {},
  loadedHolds = [],
  onStop,
  models = [],
  modelId = null,
  onModel,
}: AgenticChatViewProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const echoed = Boolean(pendingText) && lastUserText(messages) === pendingText;
  const showOptimistic = Boolean(pendingText) && !echoed;
  const showTyping = busy || Boolean(pendingText);
  const quiet = messages.length === 0 && !showOptimistic && !ask && !approval && connects.length === 0;
  return (
    <div
      data-agentic-workspace
      className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-x-clip"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <DesktopPanel
        storageKey="pa.panel.chats"
        label="chats"
        edge="right"
        defaultWidth={208}
        minWidth={160}
        maxWidth={360}
        className="hidden min-h-0 min-w-0 shrink-0 border-r border-line bg-panel md:flex"
      >
        {({ collapsed, toggleButton }) => (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={`flex items-center ${collapsed ? "justify-center py-2" : "justify-between gap-1 px-2 py-2"}`}>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="pl-1 font-mono text-[10px] uppercase tracking-widest text-muted">Your Autonomous Agents</p>
                  <button type="button" className="min-h-11 px-1 text-left text-xs font-semibold text-accent-dark" onClick={onNewChat}>
                    Create new Autonomous Agent
                  </button>
                </div>
              )}
              <div className="flex items-center">{toggleButton}</div>
            </div>
            <div aria-hidden={collapsed} inert={collapsed || undefined} className={collapsed ? "hidden" : "min-h-0 flex-1"}>
              <AgentList
                threads={threads}
                activeId={activeId}
                renamingId={renamingId}
                renameDraft={renameDraft}
                onRenameDraft={setRenameDraft}
                onOpen={onOpenThread}
                onRename={(id, title) => {
                  onRename?.(id, title);
                  setRenamingId(null);
                }}
                onStartRename={(id, title) => {
                  setRenamingId(id);
                  setRenameDraft(title);
                }}
                onCancelRename={() => setRenamingId(null)}
                onDelete={(id) => onDelete?.(id)}
                onPin={(id, pinned) => onPin?.(id, pinned)}
                onDuplicate={(id) => onDuplicate?.(id)}
                onSchedule={onSchedule}
              />
            </div>
          </div>
        )}
      </DesktopPanel>
      <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
        <details data-mobile-agents className="border-b border-line md:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">Your Autonomous Agents</summary>
          <AgentList
            threads={threads}
            activeId={activeId}
            renamingId={renamingId}
            renameDraft={renameDraft}
            onRenameDraft={setRenameDraft}
            sheet
            onOpen={onOpenThread}
            onRename={(id, title) => {
              onRename?.(id, title);
              setRenamingId(null);
            }}
            onStartRename={(id, title) => {
              setRenamingId(id);
              setRenameDraft(title);
            }}
            onCancelRename={() => setRenamingId(null)}
            onDelete={(id) => onDelete?.(id)}
            onPin={(id, pinned) => onPin?.(id, pinned)}
            onDuplicate={(id) => onDuplicate?.(id)}
            onSchedule={onSchedule}
          />
        </details>
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{title}</h1>
              <button type="button" className="min-h-11 shrink-0 px-2 text-xs font-semibold text-accent-dark md:hidden" onClick={onNewChat}>
                New agent
              </button>
            </div>
            <p className="truncate text-xs text-muted">A truly autonomous agent. It thinks, acts and recovers on its own, and checks with you before anything risky.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" data-schedule-action className="min-h-11 rounded-xl border border-line bg-panel px-3 text-xs font-semibold" onClick={() => onSchedule?.(activeId || "")}>
              Schedule
            </button>
            {onModel && <ModelPicker models={models} value={modelId} onChange={onModel} />}
            {verify && (
              <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${verify.ungrounded ? "bg-gold-soft text-gold" : "bg-mint-soft text-mint"}`}>
                Jev {verify.label} {Math.round((verify.score ?? 0) * 100)}
              </span>
            )}
          </div>
        </header>
        <div ref={scrollerRef} data-transcript onScroll={onScroll} className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3 [overflow-anchor:none] sm:px-4 sm:py-4 md:px-6">
          {signedOut && (
            <p className="text-sm">
              <Link className="inline-flex min-h-11 items-center font-semibold underline" href="/signin?next=/agentic-chat">Sign in</Link> to use your Autonomous Agent.
            </p>
          )}
          {quiet && !signedOut && (
            <div className="mx-auto max-w-sm px-4 pt-16 text-center">
              <p className="text-sm font-semibold">{threads.length === 0 ? "Create your first Autonomous Agent" : "New Autonomous Agent"}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">Send a message to start. The name comes from that first message, and you can rename it.</p>
            </div>
          )}
          {notice && <p className="max-w-[min(40rem,100%)] rounded-2xl border border-mint/30 bg-mint-soft px-4 py-3 text-sm text-mint">{notice}</p>}
          {notes.map((note) => (
            <article key={note.id} className="max-w-[min(40rem,100%)] rounded-2xl border border-line bg-panel px-4 py-3 text-sm shadow-sm">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Scheduled run · {note.status}</p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{note.summary}</p>
              {note.href && (
                <Link href={note.href} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-dark">
                  Review this run
                </Link>
              )}
            </article>
          ))}
          <MessageList
            messages={messages}
            extras={transcriptCards(messages, { ask, approval, connects }, settled, loadedHolds).map((card) => ({
              after: card.after,
              id: card.id,
              node: (
                <TranscriptCard
                  card={card}
                  busy={resolvingId === card.id}
                  editArgs={editArgs}
                  onEditArgs={onEditArgs}
                  onApprove={() => onApprove(card.id)}
                  onEdit={() => onEditApproval(card.id)}
                  onReject={() => onReject(card.id)}
                  onAnswer={(text, selected) => (onAnswerAsk ? onAnswerAsk(card.id, text, selected) : onSubmit(text))}
                  onConnected={onConnected ? () => onConnected(card.id, card.connect?.app || "") : undefined}
                />
              ),
            }))}
          />
          {showOptimistic && (
            <article data-optimistic className="ml-auto max-w-[min(40rem,100%)] break-words rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm text-ground shadow-sm [overflow-wrap:anywhere]">
              {pendingText}
            </article>
          )}
          {showTyping && <TypingIndicator />}
          {error && <p className="break-words text-sm text-accent-dark">{error}</p>}
        </div>
        <details data-plan-panel className="relative z-10 w-full min-w-0 shrink-0 border-t border-line bg-panel lg:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm font-semibold">
            <span>Plan and computer</span>
            <span className="flex items-center gap-2 text-muted">
              {computer ? <span className="text-[10px] font-semibold uppercase tracking-widest text-accent-dark">Live</span> : null}
              <span className="plan-chevron" aria-hidden="true" />
            </span>
          </summary>
          <div data-plan-scroll className="max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain">
            <SidePanels todos={todos} computer={computer} open={computerOpen} onToggle={onToggleComputer} />
          </div>
        </details>
        <Composer draft={draft} ask={Boolean(ask)} busy={busy} onDraft={onDraft} onSubmit={onSubmit} onStop={onStop} />
      </section>
      <DesktopPanel
        storageKey="pa.panel.plan"
        label="plan and computer"
        edge="left"
        defaultWidth={288}
        minWidth={220}
        maxWidth={520}
        marker="desktop"
        className="hidden min-h-0 min-w-0 shrink-0 overflow-y-auto border-l border-line bg-panel lg:flex"
      >
        {({ collapsed, toggleButton }) => (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={`flex ${collapsed ? "justify-center py-2" : "items-center justify-between px-2 pt-2"}`}>
              {!collapsed && <p className="pl-1 font-mono text-[10px] uppercase tracking-widest text-muted">Plan</p>}
              {toggleButton}
            </div>
            <div aria-hidden={collapsed} inert={collapsed || undefined} className={collapsed ? "hidden" : "min-h-0 flex-1 overflow-y-auto"}>
              <SidePanels todos={todos} computer={computer} open={computerOpen} onToggle={onToggleComputer} />
            </div>
          </div>
        )}
      </DesktopPanel>
      {picker}
    </div>
  );
}

const PREVIEW_ASK: AskData = {
  question: "Which list should get the Friday recap?",
  choices: ["product", "leads", "both"],
  options: [
    { label: "Product team", value: "product", description: "The weekly list" },
    { label: "Leadership", value: "leads", description: "A short version for leads" },
    { label: "Both lists", value: "both" },
  ],
  multiSelect: false,
  allowCustom: true,
};

const PREVIEW_APPROVAL = {
  tool: "GMAIL_SEND_EMAIL",
  args: { to: "team@example.com" },
  summary: "Send the Friday recap",
};

const PREVIEW_CONNECTS = [{ app: "Gmail", url: "https://example.com/connect/gmail" }];

const PREVIEW_TODOS: TodoItem[] = [
  { id: "1", title: "Find the right list", status: "in_progress" },
  { id: "2", title: "Send the recap", status: "pending" },
];

const PREVIEW_MODELS: PublicModelCard[] = listModels({ ANTHROPIC_API_KEY: "preview" });

const PREVIEW_MESSAGES = [
  { id: "preview-user", role: "user" as const, parts: [{ type: "text" as const, text: "Send the Friday recap." }] },
  {
    id: "preview-agent",
    role: "assistant" as const,
    parts: [
      { type: "tool-search_tools", toolName: "search_tools", input: { summary: "Found Gmail", status: "ok" } },
      { type: "text" as const, text: "Which list should I use?" },
    ],
  },
] as AgenticMessage[];

const PREVIEW_THREADS: Thread[] = [
  { id: "preview-friday", title: "Friday recap", pinned: true },
  { id: "preview-inbox", title: "Inbox sweep" },
];

function usePreviewMode() {
  const [mode, setMode] = useState<"ask" | "format" | "agents" | "schedule" | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("preview");
    setMode(value === "ask" || value === "format" || value === "agents" || value === "schedule" ? value : null);
  }, []);
  return mode;
}

const FORMAT_MESSAGES = [
  { id: "format-user", role: "user" as const, parts: [{ type: "text" as const, text: "Plan the Friday recap." }] },
  {
    id: "format-agent",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: [
          "### Friday recap",
          "",
          "Here is the plan I would run:",
          "",
          "- **Inbox** — pull the threads that need a reply",
          "- **Draft** — write a short recap with the open questions",
          "- ✅ **Wait** — ask before anything is sent",
          "",
          "The send stays blocked until you approve it. The tool id is `GMAIL_SEND_EMAIL`.",
          "",
          "```ts",
          "status: \"waiting\"",
          "```",
          "",
          "| Step | State |",
          "| --- | --- |",
          "| Read inbox | Done |",
          "| Draft recap | In progress |",
          "",
          "Notes live in the [approval guide](https://example.com/approvals).",
        ].join("\n"),
      },
    ],
  },
] as AgenticMessage[];

function lastUserText(messages: AgenticMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const text = messages[i].parts.find((part) => part.type === "text" && "text" in part);
    if (text && "text" in text) return String(text.text ?? "");
  }
  return "";
}

function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      const overlap = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(overlap > 1 ? Math.round(overlap) : 0);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return inset;
}

type LoadedHold = {
  id: string;
  kind: "ask" | "approval" | "connect";
  status: "pending" | "resolved";
  at: number;
  question?: string;
  choices?: string[];
  options?: AskOption[];
  multiSelect?: boolean;
  allowCustom?: boolean;
  app?: string;
  url?: string;
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  resolution?: { label: string; selected?: string[] };
  error?: string;
};

type ShownCard = {
  id: string;
  after: number;
  kind: "ask" | "approval" | "connect";
  ask?: AskData;
  approval?: Data["approval"];
  connect?: Data["connect"];
  status: "pending" | "resolved";
  label?: string;
  selected?: string[];
  error?: string;
};

function transcriptCards(
  messages: AgenticMessage[],
  props: { ask: Data["ask"] | null; approval: Data["approval"] | null; connects: Data["connect"][] },
  settled: Record<string, { status: "pending" | "resolved"; label?: string; selected?: string[]; error?: string }>,
  loaded: LoadedHold[]
): ShownCard[] {
  const cards: ShownCard[] = [];
  const seen = new Set<string>();
  messages.forEach((message, index) => {
    const at = message.metadata && typeof message.metadata === "object" && "at" in message.metadata ? Number(message.metadata.at) : index;
    for (const part of message.parts) {
      if (part.type === "data-ask" && "data" in part) {
        const data = part.data as Data["ask"];
        pushCard(cards, seen, askCard(data.id || `ask-${index}`, at, data), settled);
      } else if (part.type === "data-approval" && "data" in part) {
        const data = part.data as Data["approval"];
        pushCard(cards, seen, approvalCard(data.id || `approval-${index}`, at, data), settled);
      } else if (part.type === "data-connect" && "data" in part) {
        const data = part.data as Data["connect"];
        pushCard(cards, seen, connectCard(data.id || data.url, at, data), settled);
      }
    }
  });
  for (const hold of loaded) {
    const after = messageIndexFor(messages, hold.at);
    if (hold.kind === "ask") pushCard(cards, seen, askCard(hold.id, after, { id: hold.id, question: hold.question || "", choices: hold.choices || [], options: hold.options || [], multiSelect: hold.multiSelect === true, allowCustom: hold.allowCustom === true }, hold), settled);
    else if (hold.kind === "approval") pushCard(cards, seen, approvalCard(hold.id, after, { id: hold.id, tool: hold.tool || "", args: hold.args || {}, summary: hold.summary || "" }, hold), settled);
    else if (hold.url) pushCard(cards, seen, connectCard(hold.id, after, { id: hold.id, app: hold.app || "", url: hold.url }, hold), settled);
  }
  if (props.ask && !cards.some((card) => card.kind === "ask" && card.ask?.question === props.ask?.question)) {
    pushCard(cards, seen, askCard(props.ask.id || "ask", -1, props.ask), settled);
  }
  if (props.approval && !cards.some((card) => card.kind === "approval" && card.approval?.summary === props.approval?.summary)) {
    pushCard(cards, seen, approvalCard(props.approval.id || "approval", -1, props.approval), settled);
  }
  for (const link of props.connects) {
    if (!cards.some((card) => card.connect?.url === link.url)) pushCard(cards, seen, connectCard(link.id || link.url, -1, link), settled);
  }
  return cards;
}

function pushCard(cards: ShownCard[], seen: Set<string>, card: ShownCard, settled: Record<string, { status: "pending" | "resolved"; label?: string; selected?: string[]; error?: string }>) {
  if (seen.has(card.id)) return;
  seen.add(card.id);
  const overlay = settled[card.id];
  cards.push(overlay ? { ...card, status: overlay.status, label: overlay.label ?? card.label, selected: overlay.selected ?? card.selected, error: overlay.error } : card);
}

function askCard(id: string, after: number, data: AskData & { id?: string }, hold?: LoadedHold): ShownCard {
  return { id, after, kind: "ask", ask: data, status: hold?.status ?? "pending", label: hold?.resolution?.label, selected: hold?.resolution?.selected, error: hold?.error };
}

function approvalCard(id: string, after: number, data: Data["approval"], hold?: LoadedHold): ShownCard {
  return { id, after, kind: "approval", approval: data, status: hold?.status ?? "pending", label: hold?.resolution?.label, selected: hold?.resolution?.selected, error: hold?.error };
}

function connectCard(id: string, after: number, data: Data["connect"], hold?: LoadedHold): ShownCard {
  return { id, after, kind: "connect", connect: data, status: hold?.status ?? "pending", label: hold?.resolution?.label, error: hold?.error };
}

function messageIndexFor(messages: AgenticMessage[], at: number): number {
  let index = -1;
  messages.forEach((message, i) => {
    const marker = message.metadata && typeof message.metadata === "object" && "at" in message.metadata ? Number(message.metadata.at) : i;
    if (marker <= at) index = i;
  });
  return index;
}

function TranscriptCard({
  card,
  busy,
  editArgs,
  onEditArgs,
  onApprove,
  onEdit,
  onReject,
  onAnswer,
  onConnected,
}: {
  card: ShownCard;
  busy: boolean;
  editArgs: string;
  onEditArgs: (value: string) => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onAnswer: (text: string, selected?: string[]) => void;
  onConnected?: () => void;
}) {
  const resolved = card.status === "resolved" ? { label: card.label || "Answered", selected: card.selected } : null;
  if (card.kind === "ask" && card.ask) {
    return <AskOptionCards ask={parseAskInput(card.ask)} busy={busy} resolved={resolved} onAnswer={(text) => onAnswer(text, [text])} />;
  }
  if (card.kind === "approval" && card.approval) {
    return (
      <ApprovalCard
        summary={card.approval.summary}
        args={card.approval.args}
        editArgs={editArgs}
        busy={busy}
        error={card.error}
        resolved={resolved}
        onEditArgs={onEditArgs}
        onApprove={onApprove}
        onEdit={onEdit}
        onReject={onReject}
      />
    );
  }
  if (card.connect?.url) {
    return <ConnectCard app={card.connect.app} url={card.connect.url} resolved={resolved} onConnected={onConnected ? () => onConnected() : undefined} />;
  }
  return null;
}

function latest<K extends keyof Data>(messages: AgenticMessage[], type: `data-${K}`): Data[K] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (part.type === type && "data" in part) return part.data as Data[K];
    }
  }
  return null;
}

function all<K extends keyof Data>(messages: AgenticMessage[], type: `data-${K}`): Data[K][] {
  const found: Data[K][] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === type && "data" in part) found.push(part.data as Data[K]);
    }
  }
  return found;
}
