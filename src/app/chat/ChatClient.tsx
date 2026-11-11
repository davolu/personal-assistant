"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { approvalTitle } from "@/assistant/approval-copy";

type Msg = { id: string; role: string; content: string; pending?: boolean };
type Approval = { id: string; tool: string; args: unknown; expiresAt: string };
type Conversation = { id: string; title: string };

export default function ChatClient() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [routinePrompt, setRoutinePrompt] = useState("");
  const [cadence, setCadence] = useState("daily");
  const scroller = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/assistant/conversations");
    if (res.status === 401) {
      setSignedOut(true);
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || "The database is not reachable yet. Start Postgres and run npx prisma db push.");
      return;
    }
    const json = (await res.json()) as { conversations: Conversation[] };
    setConversations(json.conversations ?? []);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setConversationId(id);
    const res = await fetch(`/api/assistant/conversations?id=${id}`, { method: "POST" });
    if (!res.ok) return;
    const json = (await res.json()) as { conversation: { messages: Msg[] }; approvals: Approval[] };
    setMessages(json.conversation.messages);
    setApprovals(json.approvals ?? []);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, approvals, status, error]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setError("");
    setStatus("Thinking");
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: text }]);
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, text }),
      });
      if (res.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!res.ok || !res.body) {
        setError("The assistant could not start that turn.");
        return;
      }
      await readStream(res.body, (event, data) => {
        if (event === "tool") {
          const tool = data as { tool: string; queued?: boolean; denied?: boolean };
          setStatus(tool.queued ? `Waiting to approve ${approvalTitle(tool.tool)}` : tool.denied ? `Denied ${approvalTitle(tool.tool)}` : `Used ${approvalTitle(tool.tool)}`);
        }
        if (event === "approval") {
          const approval = (data as { approval: Approval }).approval;
          setApprovals((current) => [approval, ...current]);
        }
        if (event === "token") {
          const part = String((data as { text?: string }).text ?? "");
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.pending) next[next.length - 1] = { ...last, content: last.content + part };
            else next.push({ id: `stream-${Date.now()}`, role: "assistant", content: part, pending: true });
            return next;
          });
        }
        if (event === "done") {
          const done = data as { conversationId: string; stopReason: string };
          setConversationId(done.conversationId);
          setStatus(done.stopReason === "MODEL_ANSWER" ? "" : done.stopReason);
        }
        if (event === "error") setError(String((data as { message?: string }).message ?? "Error"));
      });
      await loadList();
    } catch {
      setError("The connection dropped before the assistant finished.");
    } finally {
      setBusy(false);
      setMessages((current) => current.map((message) => ({ ...message, pending: false })));
    }
  }

  async function resolve(approval: Approval, decision: "approve" | "reject", args?: unknown) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/assistant/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: approval.id, decision, args }),
    });
    const json = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
    if (!res.ok) setError(json.error || "Could not resolve that approval");
    else if (json.reply) setMessages((current) => [...current, { id: `appr-${approval.id}`, role: "assistant", content: json.reply! }]);
    setApprovals((current) => current.filter((item) => item.id !== approval.id));
    setBusy(false);
  }

  async function addRoutine() {
    if (!routinePrompt.trim()) return;
    const res = await fetch("/api/assistant/routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: routinePrompt, cadence, name: routinePrompt.slice(0, 60) }),
    });
    if (res.ok) setRoutinePrompt("");
    else setError("Could not save that routine");
  }

  async function upload(file: File) {
    const text = await file.text();
    const res = await fetch("/api/assistant/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, text }),
    });
    const json = (await res.json().catch(() => ({}))) as { chunks?: number; error?: string };
    setStatus(res.ok ? `Saved ${json.chunks} chunks from ${file.name}` : json.error || "Upload failed");
  }

  if (signedOut) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-start justify-center px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-muted">Personal assistant</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Sign in to chat</h1>
        <p className="mt-3 text-muted">The assistant keeps your chats, connections, and approvals on your account.</p>
        <Link href="/signin" className="mt-6 rounded-xl bg-accent px-5 py-3 font-semibold text-white">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid h-full min-h-0 w-full max-w-6xl grid-cols-1 lg:grid-cols-[220px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
        <button
          className="m-3 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-ground"
          onClick={() => {
            setConversationId(null);
            setMessages([]);
            setApprovals([]);
          }}
        >
          New chat
        </button>
        <div className="flex-1 overflow-auto px-2">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => void openConversation(conversation.id)}
              className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-sm ${conversation.id === conversationId ? "bg-accent-soft" : "hover:bg-panel"}`}
            >
              {conversation.title}
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t border-line p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Routine</p>
          <select className="w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-sm" value={cadence} onChange={(event) => setCadence(event.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <textarea
            value={routinePrompt}
            onChange={(event) => setRoutinePrompt(event.target.value)}
            placeholder="Every run, check my calendar"
            className="h-16 w-full resize-none rounded-lg border border-line bg-panel p-2 text-sm"
          />
          <button onClick={() => void addRoutine()} className="w-full rounded-lg border border-line py-1.5 text-sm font-medium">
            Save routine
          </button>
          <label className="block cursor-pointer text-center text-xs text-muted">
            Upload .txt or .md
            <input
              type="file"
              accept=".txt,.md,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          <Link href="/apps" className="block text-center text-xs font-medium text-accent-dark">
            Connect apps
          </Link>
        </div>
      </aside>
      <section className="flex min-h-0 flex-1 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-lg pt-16 text-center">
              <h1 className="text-3xl font-bold tracking-tight">What should we do?</h1>
              <p className="mt-3 text-muted">Ask for the time, a note, a summary of a file you upload, or work in a connected app. Sends, deletes, and payments wait for your approval.</p>
            </div>
          )}
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[min(40rem,100%)] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-ink text-ground" : "border border-line bg-panel"}`}>
                {message.content}
              </div>
            </div>
          ))}
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} disabled={busy} onResolve={resolve} />
          ))}
          {status && <p className="font-mono text-xs text-muted">{status}</p>}
          {error && <p className="text-sm text-accent-dark">{error}</p>}
        </div>
        <form
          className="sticky bottom-0 z-20 shrink-0 border-t border-line bg-ground/95 p-3 backdrop-blur"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="mx-auto flex max-w-3xl gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask the assistant"
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 text-base outline-none focus:border-ink"
            />
            <button disabled={busy} className="min-h-12 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition-colors disabled:opacity-50">
              Send
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ApprovalCard({
  approval,
  disabled,
  onResolve,
}: {
  approval: Approval;
  disabled: boolean;
  onResolve: (approval: Approval, decision: "approve" | "reject", args?: unknown) => Promise<void>;
}) {
  const [raw, setRaw] = useState(JSON.stringify(approval.args, null, 2));
  return (
    <div className="rounded-2xl border border-gold bg-gold-soft p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gold">Approval required</p>
      <p className="mt-1 font-semibold">{approvalTitle(approval.tool)}</p>
      <p className="mt-1 text-xs text-muted">Expires {new Date(approval.expiresAt).toLocaleString()}. Nothing runs until you approve this exact call.</p>
      <textarea value={raw} onChange={(event) => setRaw(event.target.value)} className="mt-3 h-28 w-full rounded-lg border border-line bg-panel p-2 font-mono text-xs" />
      <div className="mt-3 flex gap-2">
        <button
          disabled={disabled}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-ground"
          onClick={() => {
            try {
              void onResolve(approval, "approve", JSON.parse(raw) as unknown);
            } catch {
              void onResolve(approval, "approve");
            }
          }}
        >
          Approve
        </button>
        <button disabled={disabled} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm" onClick={() => void onResolve(approval, "reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}

async function readStream(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: unknown) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const event = /event: (.+)/.exec(chunk)?.[1];
      const data = /data: ([\s\S]+)/.exec(chunk)?.[1];
      if (!event || !data) continue;
      try {
        onEvent(event, JSON.parse(data) as unknown);
      } catch {
        // Ignore a partial frame.
      }
    }
  }
}
