"use client";

import { useState } from "react";
import { formatAskAnswer, nextAskSelection, type AskPrompt } from "@/agentic/ask";

export const MESSAGE_WINDOW = 40;

export function windowStart(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

type TodoItem = { id: string; title: string; status: string };
type Computer = { streamUrl: string; sandboxId: string } | null;
type ToolPart = { type: string; toolName?: string; input?: unknown; text?: string };

function toolInput(part: ToolPart): { summary?: string; status?: string } {
  if (!part.input || typeof part.input !== "object") return {};
  const record = part.input as { summary?: unknown; status?: unknown };
  return {
    summary: typeof record.summary === "string" ? record.summary : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
  };
}

export function AskOptionCards({ ask, busy, onAnswer }: { ask: AskPrompt; busy: boolean; onAnswer: (text: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const multi = ask.multiSelect;

  function choose(value: string) {
    if (busy) return;
    const next = nextAskSelection(selected, value, multi);
    setSelected(next.selected);
    if (next.answer) onAnswer(next.answer);
  }

  function sendSelection() {
    const text = formatAskAnswer({ values: multi ? selected : [], custom });
    if (!text || busy) return;
    onAnswer(text);
  }

  return (
    <div data-ask-card className="chat-rise max-w-[min(40rem,100%)] rounded-2xl border border-line bg-panel p-4 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-accent-dark">Question</p>
      <p className="mt-1 text-sm font-semibold leading-relaxed">{ask.question}</p>
      {ask.options.length > 0 && (
        <div className="mt-3 grid gap-2">
          {ask.options.map((option) => {
            const pressed = multi && selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                data-option-card
                data-value={option.value}
                disabled={busy}
                aria-pressed={multi ? pressed : undefined}
                className={`flex min-h-11 w-full min-w-0 items-start gap-3 rounded-2xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${pressed ? "border-accent bg-accent-soft" : "border-line bg-ground hover:border-accent"}`}
                onClick={() => choose(option.value)}
              >
                <span className={`mt-0.5 grid size-4 shrink-0 place-items-center border text-[10px] leading-none ${multi ? "rounded-md" : "rounded-full"} ${pressed ? "border-accent bg-accent text-white" : "border-line bg-panel"}`} aria-hidden="true">
                  {pressed ? "✓" : ""}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  {option.description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{option.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {(ask.allowCustom || multi) && (
        <div className="mt-3 flex min-w-0 gap-2">
          {ask.allowCustom && (
            <input
              data-ask-custom
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendSelection();
                }
              }}
              placeholder="Other"
              aria-label="Other answer"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3 text-base outline-none focus:border-accent"
            />
          )}
          {(multi || ask.allowCustom) && (
            <button type="button" data-ask-submit disabled={busy} className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={sendSelection}>
              {multi ? "Send selection" : "Send other"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({
  summary,
  editArgs,
  busy,
  onEditArgs,
  onApprove,
  onEdit,
  onReject,
}: {
  summary: string;
  editArgs: string;
  busy: boolean;
  onEditArgs: (value: string) => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  return (
    <div data-approval-card className="chat-rise max-w-[min(40rem,100%)] rounded-2xl border border-gold bg-gold-soft p-4 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gold">Approval required</p>
      <p className="mt-1 text-sm font-semibold leading-relaxed">{summary}</p>
      <textarea value={editArgs} onChange={(event) => onEditArgs(event.target.value)} aria-label="Action arguments" className="mt-3 h-28 max-h-40 w-full rounded-xl border border-line bg-panel p-2 font-mono text-xs outline-none focus:border-accent" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" data-approve disabled={busy} className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={onApprove}>
          Approve
        </button>
        <button type="button" data-edit disabled={busy} className="min-h-11 rounded-xl border border-line bg-panel px-4 text-sm font-semibold disabled:opacity-50" onClick={onEdit}>
          Edit
        </button>
        <button type="button" data-reject disabled={busy} className="min-h-11 rounded-xl bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

export function ConnectCard({ app, url }: { app: string; url: string }) {
  return (
    <div data-connect-card className="chat-rise flex max-w-[min(40rem,100%)] flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-4 shadow-sm">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent-dark">Connect an app</p>
        <p className="mt-1 text-sm font-semibold">Connect {app} so the agent can continue.</p>
      </div>
      <a href={url} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-white">
        Connect
      </a>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div data-typing className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-sm" aria-label="Agent is working">
      <span className="typing-dot size-1.5 rounded-full bg-accent" />
      <span className="typing-dot size-1.5 rounded-full bg-accent [animation-delay:150ms]" />
      <span className="typing-dot size-1.5 rounded-full bg-accent [animation-delay:300ms]" />
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="mx-auto max-w-sm px-4 pt-16 text-center">
      <p className="text-sm font-semibold">What should we take on?</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">Ask in your own words. The agent chooses the next step, and anything that sends, deletes, or pays waits for you.</p>
    </div>
  );
}

type ChatMessage = { id: string; role: string; parts: ToolPart[] };

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const [shown, setShown] = useState(MESSAGE_WINDOW);
  const start = windowStart(messages.length, shown);
  const visible = messages.slice(start);
  const earlier = start;
  return (
    <>
      {earlier > 0 && (
        <button type="button" data-earlier-messages className="mx-auto min-h-11 rounded-full border border-line bg-panel px-4 text-xs font-semibold text-muted" onClick={() => setShown((count) => count + MESSAGE_WINDOW)}>
          Show earlier
        </button>
      )}
      {visible.map((message, index) => (
        <div key={message.id} className={index < visible.length - 2 ? "msg-skip min-w-0 max-w-full" : "min-w-0 max-w-full"}>
          <MessageBubble message={message} />
        </div>
      ))}
    </>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const user = message.role === "user";
  const blocks = groupParts(message.parts as ToolPart[]);
  return (
    <div className={user ? "ml-auto flex w-full max-w-[min(40rem,100%)] justify-end" : "flex w-full max-w-[min(40rem,100%)] flex-col gap-2"}>
      {blocks.map((block, index) => {
        if (block.kind === "tools") return <ToolChip key={`tools-${index}`} parts={block.parts} />;
        if (block.kind === "reasoning") {
          return (
            <details key={`reason-${index}`} className="max-w-full rounded-2xl border border-line bg-panel">
              <summary className="min-h-9 cursor-pointer px-3 py-2 text-xs font-semibold text-muted">Thinking</summary>
              <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-muted">{block.text}</p>
            </details>
          );
        }
        if (!block.text) return null;
        return (
          <article key={`text-${index}`} className={user ? "chat-rise max-w-full rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm text-ground shadow-sm" : "chat-rise max-w-full rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 text-sm shadow-sm"}>
            <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{block.text}</p>
          </article>
        );
      })}
    </div>
  );
}

function ToolChip({ parts }: { parts: ToolPart[] }) {
  const label = parts.length === 1 ? toolLabel(parts[0]) : `${parts.length} steps`;
  return (
    <details data-tool-activity className="max-w-full rounded-2xl border border-line bg-panel shadow-sm">
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-muted">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        {label}
      </summary>
      <ul className="space-y-1 border-t border-line px-3 py-2">
        {parts.map((part, index) => (
          <li key={index} className="text-xs leading-relaxed text-muted">
            {toolLabel(part)}
            {toolInput(part).summary ? ` · ${toolInput(part).summary}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function toolLabel(part: ToolPart): string {
  const name = part.toolName || part.type.replace(/^tool-/, "") || "tool";
  const status = toolInput(part).status;
  return status ? `${name} · ${status}` : name;
}

function groupParts(parts: ToolPart[]): Array<{ kind: "text"; text: string } | { kind: "reasoning"; text: string } | { kind: "tools"; parts: ToolPart[] }> {
  const blocks: Array<{ kind: "text"; text: string } | { kind: "reasoning"; text: string } | { kind: "tools"; parts: ToolPart[] }> = [];
  for (const part of parts) {
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.parts.push(part);
      else blocks.push({ kind: "tools", parts: [part] });
      continue;
    }
    if (part.type === "reasoning" && part.text) {
      blocks.push({ kind: "reasoning", text: part.text });
      continue;
    }
    if (part.type === "text" && part.text) blocks.push({ kind: "text", text: part.text });
  }
  return blocks;
}

export function SidePanels({
  todos,
  computer,
  open,
  onToggle,
}: {
  todos: TodoItem[];
  computer: Computer;
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
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Computer</p>
          <button type="button" className="min-h-11 px-2 text-xs font-semibold text-accent-dark" onClick={onToggle}>
            {open ? "Hide" : "Open"}
          </button>
        </div>
        {!computer && <p className="mt-2 text-xs text-muted">A desktop starts when the agent needs a site or app with no API.</p>}
        {computer && open && (
          <iframe title="Your cloud desktop" src={computer.streamUrl} data-computer-frame className="mt-2 aspect-video h-auto max-h-[min(24rem,46dvh)] w-full max-w-full rounded-xl border border-line bg-ink" allow="clipboard-read; clipboard-write" />
        )}
        {computer && <p className="mt-2 text-xs text-muted">Take over in this view for sign-in, 2FA, or a captcha, then answer the question in the chat.</p>}
      </div>
    </div>
  );
}
