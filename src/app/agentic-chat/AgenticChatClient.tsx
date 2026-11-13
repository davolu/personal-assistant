"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { parseAskInput } from "@/agentic/ask";
import { listModels } from "@/agentic/models";
import type { AskOption } from "@/agentic/types";
import { ApprovalCard, AskOptionCards, ConnectCard, EmptyState, MessageList, ModelPicker, SidePanels, TypingIndicator, type PublicModelCard } from "./chat-ui";

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
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onToggleComputer: () => void;
  onEditArgs: (value: string) => void;
  onApprove: () => void;
  onEditApproval: () => void;
  onReject: () => void;
  models?: PublicModelCard[];
  modelId?: string | null;
  onModel?: (id: string) => void;
};

export default function AgenticChatClient() {
  const threadRef = useRef<string | null>(null);
  const resumeRef = useRef<Record<string, unknown> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
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
  const preview = useAskPreview();

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

  const { messages, sendMessage, status, error, setMessages } = useChat<AgenticMessage>({ transport });
  const busy = status === "submitted" || status === "streaming";
  const ask = latest(messages, "data-ask");
  const approval = latest(messages, "data-approval");
  const connects = all(messages, "data-connect");
  const todos = latest(messages, "data-todo")?.items ?? [];
  const verify = latest(messages, "data-verify");
  const computer = latest(messages, "data-computer");

  useEffect(() => {
    const found = latest(messages, "data-thread");
    if (found?.threadId) threadRef.current = found.threadId;
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

  async function openThread(id: string) {
    threadRef.current = id;
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

  const showPreview = preview && messages.length === 0;
  return (
    <AgenticChatView
      threads={threads}
      signedOut={signedOut}
      messages={showPreview ? PREVIEW_MESSAGES : messages}
      ask={showPreview ? PREVIEW_ASK : ask}
      approval={showPreview ? PREVIEW_APPROVAL : approval}
      connects={showPreview ? PREVIEW_CONNECTS : connects}
      todos={showPreview ? PREVIEW_TODOS : todos}
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
        setMessages([]);
      }}
      onOpenThread={(id) => void openThread(id)}
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
  onDraft,
  onSubmit,
  onToggleComputer,
  onEditArgs,
  onApprove,
  onEditApproval,
  onReject,
  models = [],
  modelId = null,
  onModel,
}: AgenticChatViewProps) {
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
      <aside className="hidden min-h-0 w-40 min-w-0 shrink-0 flex-col border-r border-line bg-panel md:flex lg:w-52 xl:w-56">
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Chats</p>
          <button type="button" className="min-h-11 px-2 text-xs font-semibold text-accent-dark" onClick={onNewChat}>
            New
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button type="button" className="min-h-11 w-full truncate rounded-lg px-2 text-left text-sm hover:bg-ground" onClick={() => onOpenThread(thread.id)}>
                {thread.title || "New chat"}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">Agentic chat</h1>
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
              <Link className="inline-flex min-h-11 items-center font-semibold underline" href="/signin?next=/agentic-chat">Sign in</Link> to use the agent.
            </p>
          )}
          {quiet && !signedOut && <EmptyState />}
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
        <form
          data-composer
          className="relative z-20 w-full min-w-0 shrink-0 border-t border-line bg-ground p-2 sm:p-3"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(draft);
          }}
        >
          <div className="flex min-w-0 gap-2">
            <input
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              placeholder={ask ? "Answer the question" : "Ask the agent"}
              aria-label={ask ? "Answer the question" : "Message"}
              enterKeyHint="send"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 text-base outline-none focus:border-accent sm:px-4"
            />
            <button disabled={busy} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">
              Send
            </button>
          </div>
        </form>
      </section>
      <aside data-desktop-panel className="hidden min-h-0 w-60 min-w-0 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel lg:flex xl:w-72">
        <SidePanels todos={todos} computer={computer} open={computerOpen} onToggle={onToggleComputer} />
      </aside>
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

function useAskPreview() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).get("preview") === "ask");
  }, []);
  return on;
}

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
