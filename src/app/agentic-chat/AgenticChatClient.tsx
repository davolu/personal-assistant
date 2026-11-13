"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { parseAskInput } from "@/agentic/ask";
import { listModels } from "@/agentic/models";
import type { AskOption } from "@/agentic/types";
import { DesktopPanel } from "@/components/DesktopPanel";
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
  ask: AskData;
  connect: { app: string; url: string };
  approval: { tool: string; args: Record<string, unknown>; summary: string };
  verify: { score: number; label: string; ungrounded: boolean; feedback: string };
  computer: { streamUrl: string; sandboxId: string };
};

type AgenticMessage = UIMessage<unknown, Data>;
type TodoItem = { id: string; title: string; status: string };
type Thread = { id: string; title: string };

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
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onToggleComputer: () => void;
  onEditArgs: (value: string) => void;
  onApprove: () => void;
  onEditApproval: () => void;
  onReject: () => void;
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
  const [models, setModels] = useState<PublicModelCard[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
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
    const json = (await res.json()) as { messages?: { role: string; text: string }[] };
    setMessages(
      (json.messages ?? []).map((message, index) => ({
        id: `${id}-${index}`,
        role: message.role as "user" | "assistant",
        parts: [{ type: "text" as const, text: message.text }],
      }))
    );
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || preview) return;
    setDraft("");
    setPendingText(trimmed);
    pinned.current = true;
    void sendMessage({ text: trimmed });
  }

  const showAsk = preview === "ask" && messages.length === 0;
  const showFormat = preview === "format" && messages.length === 0;
  return (
    <AgenticChatView
      threads={threads}
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
        setMessages([]);
      }}
      onOpenThread={(id) => void openThread(id)}
      activeId={activeId}
      onRename={(id, title) => void renameAgent(id, title)}
      onDraft={setDraft}
      onSubmit={submit}
      onToggleComputer={() => setComputerOpen((value) => !value)}
      onEditArgs={setEditArgs}
      onApprove={() => {
        resumeRef.current = { decision: "approve" };
        void sendMessage({ text: "Approved" });
      }}
      onEditApproval={() => {
        try {
          resumeRef.current = { decision: "edit", args: JSON.parse(editArgs) as Record<string, unknown> };
          void sendMessage({ text: "Approved with edits" });
        } catch {
          setDraft("The edited JSON is not valid.");
        }
      }}
      onReject={() => {
        resumeRef.current = { decision: "reject" };
        void sendMessage({ text: "Reject" });
      }}
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
  onDraft,
  onSubmit,
  onToggleComputer,
  onEditArgs,
  onApprove,
  onEditApproval,
  onReject,
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
            <ul aria-hidden={collapsed} inert={collapsed || undefined} className={collapsed ? "hidden" : "min-h-0 flex-1 overflow-y-auto px-2 pb-3"}>
              {threads.length === 0 && <li className="px-2 py-2 text-sm text-muted">Create your first Autonomous Agent</li>}
              {threads.map((thread) => (
                <li key={thread.id} className="flex items-center gap-1">
                  {renamingId === thread.id ? (
                    <form
                      className="flex min-w-0 flex-1 gap-1 py-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onRename?.(thread.id, renameDraft);
                        setRenamingId(null);
                      }}
                    >
                      <input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        aria-label="Agent name"
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-ground px-2 text-sm"
                        autoFocus
                      />
                      <button type="submit" className="min-h-11 px-1 text-xs font-semibold text-accent-dark">Save</button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className={`min-h-11 min-w-0 flex-1 truncate rounded-lg px-2 text-left text-sm hover:bg-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${activeId === thread.id ? "bg-ground font-semibold" : ""}`} onClick={() => onOpenThread(thread.id)}>
                        {thread.title || "New agent"}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 shrink-0 px-1 text-[11px] font-semibold text-muted"
                        onClick={() => {
                          setRenamingId(thread.id);
                          setRenameDraft(thread.title || "");
                        }}
                      >
                        Rename
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DesktopPanel>
      <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold">Autonomous Agent</h1>
              <button type="button" className="min-h-11 px-2 text-xs font-semibold text-accent-dark md:hidden" onClick={onNewChat}>
                New agent
              </button>
            </div>
            <p className="hidden text-xs text-muted sm:line-clamp-2 sm:block [@media(max-height:420px)]:sm:hidden">Claude decides the next step. Sends, deletes, and payments wait for you.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          <MessageList messages={messages} />
          {ask && <AskOptionCards ask={parseAskInput(ask)} busy={busy} onAnswer={onSubmit} />}
          {connects.map((link) => (
            <ConnectCard key={link.url} app={link.app} url={link.url} />
          ))}
          {approval && (
            <ApprovalCard summary={approval.summary} editArgs={editArgs} busy={busy} onEditArgs={onEditArgs} onApprove={onApprove} onEdit={onEditApproval} onReject={onReject} />
          )}
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

function usePreviewMode() {
  const [mode, setMode] = useState<"ask" | "format" | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("preview");
    setMode(value === "ask" || value === "format" ? value : null);
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
