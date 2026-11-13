"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatAskAnswer, nextAskSelection, type AskPrompt } from "@/agentic/ask";
import { watchConnection } from "@/components/connect-watch";
import { EmptyArt } from "@/components/illustrations";
import { REPLAY_MASK_CLASS } from "@/lib/posthog";
import { readableError } from "@/lib/readable-error";
import { composerKeyAction } from "./composer-key";
import { previewBlocks } from "./html-preview";
import { MarkdownMessage } from "./MarkdownMessage";

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

export function AskOptionCards({
  ask,
  busy,
  onAnswer,
  resolved,
}: {
  ask: AskPrompt;
  busy: boolean;
  onAnswer: (text: string) => void;
  resolved?: { label: string; selected?: string[] } | null;
}) {
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

  const locked = busy || Boolean(resolved);
  const chosen = new Set(resolved?.selected ?? []);
  return (
    <div data-ask-card data-resolved={resolved ? "true" : "false"} className={`chat-rise surface max-w-[min(40rem,100%)] p-4 ${resolved ? "text-muted" : ""}`}>
      <p className="kicker">{resolved ? "Answered" : "Question"}</p>
      <p className="mt-1 text-sm font-semibold leading-relaxed">{ask.question}</p>
      {ask.options.length > 0 && (
        <div className="mt-3 grid gap-2">
          {ask.options.map((option) => {
            const pressed = chosen.has(option.value) || (multi && selected.includes(option.value));
            return (
              <button
                key={option.value}
                type="button"
                data-option-card
                data-value={option.value}
                disabled={locked}
                aria-pressed={multi ? pressed : undefined}
                className={`flex min-h-11 w-full min-w-0 items-start gap-3 rounded-2xl border px-3 py-2 text-left transition-colors disabled:opacity-70 ${pressed ? "border-ink bg-ink text-ground" : resolved ? "border-line bg-panel opacity-70" : "border-line bg-ground hover:border-accent"}`}
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
      {resolved && <p className="mt-3 inline-flex rounded-full bg-ink px-3 py-1 text-sm font-semibold text-ground">{resolved.label}</p>}
      {!resolved && (ask.allowCustom || multi) && (
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
            <button type="button" data-ask-submit disabled={locked} className="btn-ink shrink-0 px-4 text-sm disabled:opacity-50" onClick={sendSelection}>
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
  args,
  editArgs,
  busy,
  error,
  resolved,
  onEditArgs,
  onApprove,
  onEdit,
  onReject,
}: {
  summary: string;
  args?: Record<string, unknown>;
  editArgs: string;
  busy: boolean;
  error?: string | null;
  resolved?: { label: string } | null;
  onEditArgs: (value: string) => void;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const locked = busy || Boolean(resolved);
  const blocks = previewBlocks(args ?? {});
  return (
    <div data-approval-card data-resolved={resolved ? "true" : "false"} className={`chat-rise max-w-[min(40rem,100%)] rounded-3xl border p-4 shadow-[var(--shadow-card)] ${resolved ? "border-line bg-ground text-muted" : "border-yellow/80 bg-gold-soft"}`}>
      <p className={`kicker ${resolved ? "" : "text-gold"}`}>{resolved ? "Resolved" : "Waiting for approval"}</p>
      <p className={`${REPLAY_MASK_CLASS} mt-1 text-sm font-semibold leading-relaxed`}>{summary}</p>
      {blocks.length > 0 && (
        <div className={`${REPLAY_MASK_CLASS} mt-3 max-h-40 space-y-2 overflow-y-auto rounded-xl border border-line bg-panel p-3 text-sm text-ink`}>
          {blocks.map((block, index) => (
            <div key={`${block.label}-${index}`}>
              <p className="panel-label">{block.label}</p>
              {block.html ? <div className="mt-1" dangerouslySetInnerHTML={{ __html: block.html }} /> : <p className="mt-1 whitespace-pre-wrap break-words">{block.text}</p>}
            </div>
          ))}
        </div>
      )}
      {!resolved && editing && (
        <textarea value={editArgs} onChange={(event) => onEditArgs(event.target.value)} aria-label="Action arguments" name="action-arguments" className={`${REPLAY_MASK_CLASS} mt-3 h-28 max-h-40 w-full rounded-xl border border-line bg-panel p-2 font-mono text-xs outline-none focus:border-accent`} />
      )}
      {resolved && <p className="mt-3 inline-flex rounded-full bg-ink px-3 py-1 text-sm font-semibold text-ground">{resolved.label}</p>}
      {error && !resolved && <p className="mt-3 text-sm font-medium text-danger">{readableError(error)}</p>}
      {!resolved && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" data-approve disabled={locked} className="btn-ink px-4 text-sm disabled:opacity-50" onClick={onApprove}>
            Approve
          </button>
          <button
            type="button"
            data-edit
            disabled={locked}
            className="btn-ghost px-4 text-sm disabled:opacity-50"
            onClick={() => {
              if (!editing) {
                setEditing(true);
                return;
              }
              onEdit();
            }}
          >
            {editing ? "Edited and approved" : "Edit"}
          </button>
          <button type="button" data-reject disabled={locked} className="min-h-11 rounded-full bg-coral px-4 text-sm font-semibold text-ink disabled:opacity-50" onClick={onReject}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

export function ConnectCard({
  app,
  url,
  resolved,
  onConnected,
}: {
  app: string;
  url: string;
  resolved?: { label: string } | null;
  onConnected?: (app: string) => void;
}) {
  useEffect(() => {
    if (resolved || !onConnected) return;
    return watchConnection({ app, onConnected });
  }, [app, onConnected, resolved]);
  return (
    <div data-connect-card data-resolved={resolved ? "true" : "false"} className={`chat-rise flex max-w-[min(40rem,100%)] flex-wrap items-center justify-between gap-3 rounded-3xl border p-4 shadow-[var(--shadow-card)] ${resolved ? "border-line bg-ground text-muted" : "border-line bg-accent-soft"}`}>
      <div className="min-w-0">
        <p className="kicker">{resolved ? "Connected" : "Connect an app"}</p>
        <p className="mt-1 text-sm font-semibold">{resolved ? resolved.label : `Connect ${app} so the agent can continue.`}</p>
      </div>
      {resolved ? (
        <span className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-sm font-semibold text-ground">{resolved.label}</span>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="btn-ink px-4 text-sm">
          Connect
        </a>
      )}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div data-typing className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-sm" aria-label="Agent is working">
      <span className="typing-dot size-1.5 rounded-full bg-blue" />
      <span className="typing-dot size-1.5 rounded-full bg-green [animation-delay:150ms]" />
      <span className="typing-dot size-1.5 rounded-full bg-coral [animation-delay:300ms]" />
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="mx-auto max-w-sm px-4 pt-10 text-center">
      <EmptyArt kind="chats" />
      <p className="mt-3 text-base font-semibold text-ink">What should we take on?</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">Ask in your own words. The agent chooses the next step, and anything that sends, deletes, or pays waits for you.</p>
    </div>
  );
}

type ChatMessage = { id: string; role: string; parts: ToolPart[] };

export function MessageList({ messages, extras = [] }: { messages: ChatMessage[]; extras?: { after: number; id: string; node: ReactNode }[] }) {
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
      {visible.map((message, index) => {
        const absolute = start + index;
        const here = extras.filter((extra) => extra.after === absolute);
        return (
          <div key={message.id} className={index < visible.length - 2 ? "msg-skip min-w-0 max-w-full space-y-3" : "min-w-0 max-w-full space-y-3"}>
            <MessageBubble message={message} />
            {here.map((extra) => (
              <div key={extra.id}>{extra.node}</div>
            ))}
          </div>
        );
      })}
      {extras
        .filter((extra) => extra.after < 0 || extra.after >= messages.length)
        .map((extra) => (
          <div key={extra.id}>{extra.node}</div>
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
              <p className={`${REPLAY_MASK_CLASS} border-t border-line px-3 py-2 text-xs leading-relaxed text-muted`}>{block.text}</p>
            </details>
          );
        }
        if (!block.text) return null;
        return (
          <article key={`text-${index}`} data-chat-message className={user ? `${REPLAY_MASK_CLASS} chat-rise max-w-full rounded-2xl rounded-br-md bg-ink px-4 py-3 text-[15px] leading-relaxed text-ground shadow-sm` : `${REPLAY_MASK_CLASS} chat-rise max-w-full rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 text-[15px] leading-relaxed shadow-sm`}>
            {user ? (
              <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{block.text}</p>
            ) : (
              <MarkdownMessage text={block.text} />
            )}
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
      <ul className={`${REPLAY_MASK_CLASS} space-y-1 border-t border-line px-3 py-2`}>
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
        <p className="panel-label">Todo</p>
        <ul className="mt-2 space-y-1">
          {todos.length === 0 && <li className="text-sm leading-relaxed text-muted">The agent writes its plan here.</li>}
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
          <p className="panel-label">Computer</p>
          <button type="button" className="min-h-11 px-2 text-sm text-link" onClick={onToggle}>
            {open ? "Hide" : "Open"}
          </button>
        </div>
        {!computer && <p className="mt-2 text-sm leading-relaxed text-muted">A desktop starts when the agent needs a site or app with no API.</p>}
        {computer && open && (
          <iframe title="Your cloud desktop" src={computer.streamUrl} data-computer-frame className={`${REPLAY_MASK_CLASS} mt-2 aspect-video h-auto max-h-[min(24rem,46dvh)] w-full max-w-full rounded-xl border border-line bg-ink`} allow="clipboard-read; clipboard-write" />
        )}
        {computer && <p className="mt-2 text-sm leading-relaxed text-muted">Take over in this view for sign-in, 2FA, or a captcha, then answer the question in the chat.</p>}
      </div>
    </div>
  );
}

export function Composer({
  draft,
  ask,
  busy,
  onDraft,
  onSubmit,
  onStop,
}: {
  draft: string;
  ask: boolean;
  busy: boolean;
  onDraft: (value: string) => void;
  onSubmit: (text: string) => void;
  onStop?: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const placeholder = ask ? "Answer the question" : "Message your Autonomous Agent";
  const empty = draft.trim().length === 0;

  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "0px";
    const next = Math.min(node.scrollHeight, 160);
    node.style.height = `${Math.max(next, 44)}px`;
  }, [draft]);

  return (
    <form
      data-composer
      className={`${REPLAY_MASK_CLASS} glass relative z-20 w-full min-w-0 shrink-0 border-t p-2 sm:p-3`}
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit(draft);
      }}
    >
      <div className="composer-shell flex min-w-0 items-end gap-1.5 rounded-[1.75rem] border border-line bg-panel py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-card)] focus-within:border-ink/30 focus-within:shadow-[0_18px_40px_-22px_rgba(26,25,22,0.45)] sm:gap-2 sm:pl-5">
        <textarea
          ref={field}
          rows={1}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (composerKeyAction(event.key, event.shiftKey, event.nativeEvent.isComposing, busy) !== "send") return;
            event.preventDefault();
            onSubmit(draft);
          }}
          placeholder={placeholder}
          aria-label={ask ? "Answer the question" : "Message"}
          enterKeyHint="send"
          className={`${REPLAY_MASK_CLASS} max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-base leading-6 text-ink outline-none placeholder:text-muted`}
        />
        {busy ? (
          <button
            type="button"
            aria-label="Stop the agent"
            onClick={() => onStop?.()}
            className="composer-stop grid size-11 shrink-0 place-items-center rounded-full text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <StopIcon />
            <span className="sr-only">Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            disabled={empty}
            aria-label="Send"
            className="composer-send grid size-11 shrink-0 place-items-center rounded-full text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <ArrowUpIcon />
            <span className="sr-only">Send</span>
          </button>
        )}
      </div>
    </form>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <path d="M9 14.25V4.25M9 4.25 4.25 9M9 4.25 13.75 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2.25" y="2.25" width="9.5" height="9.5" rx="1.75" fill="currentColor" />
    </svg>
  );
}

export type PublicModelCard = {
  id: string;
  provider: string;
  label: string;
  model: string;
  env: string;
  available: boolean;
  hint?: string;
  capabilities: { tools: boolean; thinking: boolean; computer: boolean; promptCache: boolean; vision?: boolean };
};

export function ModelMenuList({
  models,
  value,
  onChange,
}: {
  models: PublicModelCard[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const groups = [...new Set(models.map((model) => model.provider))];
  return (
    <div className="p-2">
      {groups.map((provider) => (
        <section key={provider} className="mb-2">
          <p className="panel-label px-2 pb-1 pt-2">{providerName(provider)}</p>
          <ul>
            {models
              .filter((model) => model.provider === provider)
              .map((model) => (
                <li key={model.id}>
                  <button
                    type="button"
                    data-model-id={model.id}
                    data-available={model.available ? "true" : "false"}
                    disabled={!model.available}
                    aria-disabled={model.available ? undefined : true}
                    title={model.available ? model.label : undefined}
                    className={`flex min-h-11 w-full min-w-0 flex-col items-start rounded-xl px-3 py-2 text-left ${model.available ? "hover:bg-accent-soft" : "cursor-not-allowed opacity-50"} ${value === model.id ? "bg-accent-soft" : ""}`}
                    onClick={() => {
                      if (model.available) onChange(model.id);
                    }}
                  >
                    <span className="text-sm font-semibold">{model.label}</span>
                    <span className="text-xs text-muted">{model.hint || model.model}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function providerName(provider: string): string {
  const names: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    xai: "xAI",
    mistral: "Mistral",
    deepseek: "DeepSeek",
    groq: "Groq",
    openrouter: "OpenRouter",
  };
  return names[provider] ?? provider;
}

export function ModelPicker({
  models,
  value,
  onChange,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  models: PublicModelCard[];
  value: string | null;
  onChange: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  function setOpen(next: boolean) {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolled(next);
  }
  const current = models.find((model) => model.id === value);
  if (!models.length) return null;
  if (hideTrigger && !open) return null;
  return (
    <div className={hideTrigger ? undefined : "relative shrink-0"}>
      {!hideTrigger && (
        <button
          type="button"
          data-model-picker
          className="inline-flex min-h-11 max-w-[9rem] items-center gap-1 truncate rounded-xl border border-line bg-panel px-3 text-xs font-semibold sm:max-w-[14rem] sm:text-sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className="truncate">{current?.label ?? "Model"}</span>
        </button>
      )}
      {open && (
        <div data-overlay className="fixed inset-0 z-50 flex items-end justify-center lg:items-start lg:justify-center lg:pt-16">
          <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Close models" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Choose a model"
            data-model-sheet
            className="relative z-10 mb-[calc(4.5rem+env(safe-area-inset-bottom))] max-h-[min(70dvh,32rem)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-panel shadow-[var(--shadow-card)] lg:mb-0 lg:rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="text-sm font-semibold">Model</p>
              <button type="button" className="min-h-11 px-2 text-sm font-semibold" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <ModelMenuList
              models={models}
              value={value}
              onChange={(id) => {
                onChange(id);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
