"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Data = {
  thread: { threadId: string };
  todo: { items: TodoItem[] };
  ask: { question: string; choices: string[] };
  connect: { app: string; url: string };
  approval: { tool: string; args: Record<string, unknown>; summary: string };
  verify: { score: number; label: string; ungrounded: boolean; feedback: string };
  computer: { streamUrl: string; sandboxId: string };
};

type AgenticMessage = UIMessage<unknown, Data>;
type TodoItem = { id: string; title: string; status: string };

export default function AgenticChatClient() {
  const threadRef = useRef<string | null>(null);
  const resumeRef = useRef<Record<string, unknown> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [computerOpen, setComputerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editArgs, setEditArgs] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgenticMessage>({
        api: "/api/agentic-chat",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const resume = resumeRef.current;
          resumeRef.current = null;
          return { body: { ...body, messages, threadId: threadRef.current, resume } };
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
        const json = (await res.json()) as { threads?: { id: string; title: string }[] };
        setThreads(json.threads ?? []);
      })
      .catch(() => undefined);
  }, [busy]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, ask, approval]);

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
    if (!trimmed || busy) return;
    setDraft("");
    void sendMessage({ text: trimmed });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="flex items-center justify-between px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Chats</p>
          <button type="button" className="text-xs font-semibold text-accent-dark" onClick={() => { threadRef.current = null; setMessages([]); }}>
            New
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button type="button" className="w-full truncate rounded-lg px-2 py-2 text-left text-sm hover:bg-ground" onClick={() => void openThread(thread.id)}>
                {thread.title || "New chat"}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold">Agentic chat</h1>
            <p className="text-xs text-muted">Claude decides the next step. Sends, deletes, and payments wait for you.</p>
          </div>
          {verify && (
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${verify.ungrounded ? "bg-gold-soft text-gold" : "bg-mint-soft text-mint"}`}>
              Jev {verify.label} {Math.round((verify.score ?? 0) * 100)}
            </span>
          )}
        </header>
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 md:px-6">
          {signedOut && (
            <p className="text-sm">
              <Link className="font-semibold underline" href="/signin?next=/agentic-chat">Sign in</Link> to use the agent.
            </p>
          )}
          {messages.map((message) => (
            <article key={message.id} className={message.role === "user" ? "ml-auto max-w-[min(40rem,100%)] rounded-2xl bg-ink px-4 py-3 text-sm text-ground" : "max-w-[min(40rem,100%)] space-y-2"}>
              {message.parts.map((part, index) => {
                if (part.type === "text") return <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>;
                if (part.type === "reasoning") return <p key={index} className="text-xs text-muted">{part.text}</p>;
                if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                  const tool = part as { type: string; toolName?: string; input?: { summary?: string; status?: string } };
                  return (
                    <p key={index} className="rounded-xl border border-line bg-panel px-3 py-2 text-xs text-muted">
                      {tool.toolName ?? "tool"} · {tool.input?.status ?? "step"} · {tool.input?.summary ?? ""}
                    </p>
                  );
                }
                return null;
              })}
            </article>
          ))}
          {connects.map((link) => (
            <a key={link.url} href={link.url} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-white">
              Connect {link.app}
            </a>
          ))}
          {ask && (
            <div className="max-w-[min(40rem,100%)] rounded-2xl border border-line bg-panel p-4">
              <p className="text-sm">{ask.question}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ask.choices.map((choice) => (
                  <button key={choice} type="button" disabled={busy} className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => submit(choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            </div>
          )}
          {approval && (
            <div className="max-w-[min(40rem,100%)] rounded-2xl border border-gold bg-gold-soft p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-gold">Approval required</p>
              <p className="mt-1 text-sm font-semibold">{approval.summary}</p>
              <textarea value={editArgs} onChange={(event) => setEditArgs(event.target.value)} className="mt-3 h-28 w-full rounded-lg border border-line bg-panel p-2 font-mono text-xs" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className="min-h-11 rounded-lg bg-ink px-3 text-sm font-semibold text-ground" onClick={() => { resumeRef.current = { decision: "approve" }; void sendMessage({ text: "Approved" }); }}>
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-11 rounded-lg border border-line bg-panel px-3 text-sm"
                  onClick={() => {
                    try {
                      resumeRef.current = { decision: "edit", args: JSON.parse(editArgs) as Record<string, unknown> };
                      void sendMessage({ text: "Approved with edits" });
                    } catch {
                      setDraft("The edited JSON is not valid.");
                    }
                  }}
                >
                  Edit
                </button>
                <button type="button" disabled={busy} className="min-h-11 rounded-lg border border-line bg-panel px-3 text-sm" onClick={() => { resumeRef.current = { decision: "reject" }; void sendMessage({ text: "Reject" }); }}>
                  Reject
                </button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-accent-dark">{error.message}</p>}
        </div>
        <form
          className="border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <div className="flex gap-2">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={ask ? "Answer the question" : "Ask the agent"} className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 text-base outline-none focus:border-ink" />
            <button disabled={busy} className="min-h-12 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">Send</button>
          </div>
        </form>
      </section>
      <aside className="hidden w-72 shrink-0 flex-col border-l border-line bg-panel lg:flex">
        <SidePanels todos={todos} computer={computer} open={computerOpen} onToggle={() => setComputerOpen((value) => !value)} />
      </aside>
      <div className="fixed inset-x-3 bottom-20 z-30 lg:hidden">
        <details className="rounded-2xl border border-line bg-panel p-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold">Plan and computer</summary>
          <SidePanels todos={todos} computer={computer} open={computerOpen} onToggle={() => setComputerOpen((value) => !value)} />
        </details>
      </div>
    </div>
  );
}

function SidePanels({
  todos,
  computer,
  open,
  onToggle,
}: {
  todos: TodoItem[];
  computer: { streamUrl: string; sandboxId: string } | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Todo</p>
        <ul className="mt-2 space-y-1">
          {todos.length === 0 && <li className="text-xs text-muted">The agent writes its plan here.</li>}
          {todos.map((item) => (
            <li key={item.id} className="text-sm">
              <span className="mr-2 text-muted">{item.status === "done" ? "✓" : item.status === "in_progress" ? "…" : "○"}</span>
              {item.title}
            </li>
          ))}
        </ul>
      </div>
      <div className="min-h-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Computer</p>
          <button type="button" className="text-xs font-semibold" onClick={onToggle}>{open ? "Hide" : "Open"}</button>
        </div>
        {!computer && <p className="mt-2 text-xs text-muted">A desktop starts when the agent needs a site or app with no API.</p>}
        {computer && open && (
          <iframe title="Your cloud desktop" src={computer.streamUrl} className="mt-2 h-64 w-full rounded-xl border border-line bg-ink" allow="clipboard-read; clipboard-write" />
        )}
        {computer && (
          <p className="mt-2 text-xs text-muted">Take over in this view for sign-in, 2FA, or a captcha, then answer the question in the chat.</p>
        )}
      </div>
    </div>
  );
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
