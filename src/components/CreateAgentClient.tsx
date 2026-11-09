"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toolkitLogo } from "@/lib/toolkits";
import type { AgentPlan } from "@/lib/planner";

const EXAMPLES = [
  "When a client hasn't paid an invoice after 7 days, send them a polite reminder email and keep nudging weekly",
  "Every morning, summarize my unread emails and post the summary to my Slack",
  "When someone books a call on my Calendly, research them and send me a prep note",
];

const DRAFT_STAGES = [
  "Reading your request…",
  "Picking the right apps…",
  "Checking what each app's API can really do…",
  "Writing the exact tool-by-tool procedure…",
  "Double-checking feasibility…",
];
const REFINE_STAGES = [
  "Reading your note…",
  "Re-checking the apps' capabilities…",
  "Updating the plan…",
];

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; plan?: AgentPlan; isError?: boolean };

function Thinking({ stages, tick }: { stages: string[]; tick: number }) {
  const label = stages[Math.min(tick, stages.length - 1)];
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted">
      <span className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
      </span>
      <span className="animate-pulse italic">{label}</span>
    </div>
  );
}

export default function CreateAgentClient({
  initialIdea = "",
  editId,
}: {
  initialIdea?: string;
  editId?: string;
}) {
  const router = useRouter();
  const [idea, setIdea] = useState(initialIdea);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState<"draft" | "refine" | null>(null);
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const inChat = messages.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  useEffect(() => {
    if (!thinking) return;
    setTick(0);
    const t = setInterval(() => setTick((n) => n + 1), 3500);
    return () => clearInterval(t);
  }, [thinking]);

  function pushAssistant(msg: Omit<Extract<Msg, { role: "assistant" }>, "role">) {
    setMessages((m) => [...m, { role: "assistant", ...msg }]);
  }

  async function draft() {
    if (idea.trim().length < 10) return;
    setMessages([{ role: "user", text: idea }]);
    setThinking("draft");
    try {
      const res = await fetch("/api/create/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea }),
      });
      const json = await res.json();
      if (!res.ok) {
        pushAssistant({
          text:
            res.status === 401
              ? "Sign in first — then come back and I'll build your agent."
              : json.error || "I couldn't draft a plan — try rewording your idea.",
          isError: true,
        });
      } else {
        setPlan(json.plan);
        pushAssistant({
          text: "Here's the agent I designed for you. Approve it to go live, or keep chatting with me to adjust anything.",
          plan: json.plan,
        });
      }
    } catch {
      pushAssistant({ text: "I couldn't reach the server — try again.", isError: true });
    } finally {
      setThinking(null);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || thinking || !plan) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setThinking("refine");
    try {
      const res = await fetch("/api/create/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, plan, feedback: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        pushAssistant({ text: json.error || "I couldn't update the plan — try again.", isError: true });
      } else {
        setPlan(json.plan);
        pushAssistant({ text: "Updated — here's the revised plan.", plan: json.plan });
      }
    } catch {
      pushAssistant({ text: "I couldn't reach the server — try again.", isError: true });
    } finally {
      setThinking(null);
    }
  }

  async function approve() {
    if (!plan || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/create/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, visibility, idea, editId }),
      });
      const json = await res.json();
      if (!res.ok) {
        pushAssistant({ text: json.error || "Couldn't save the agent — try again.", isError: true });
        setSaving(false);
        return;
      }
      router.push(json.connect);
    } catch {
      pushAssistant({ text: "Couldn't reach the server — try again.", isError: true });
      setSaving(false);
    }
  }

  const latestPlanIndex = messages.reduce(
    (acc, m, i) => (m.role === "assistant" && m.plan ? i : acc),
    -1
  );

  // ---------- compose view ----------
  if (!inChat) {
    return (
      <div>
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          placeholder="e.g. When a new support email arrives, draft a reply using our FAQ and let me approve it before it sends…"
          className="w-full rounded-xl border border-line bg-panel px-4 py-3.5 text-[15px] shadow-sm outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              onClick={() => setIdea(e)}
              className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted transition hover:border-ink/30 hover:text-ink"
            >
              {e.slice(0, 52)}…
            </button>
          ))}
        </div>
        <button
          onClick={draft}
          disabled={idea.trim().length < 10}
          className="mt-5 w-full rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark disabled:opacity-50"
        >
          {editId ? "✨ Regenerate from this description" : "✨ Draft my agent"}
        </button>
      </div>
    );
  }

  // ---------- chat view ----------
  return (
    <div>
      <div className="space-y-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm leading-relaxed text-ground">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div
                className={`${m.plan ? "w-full" : "max-w-[85%]"} rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-sm`}
              >
                <p className={`text-sm leading-relaxed ${m.isError ? "text-accent-dark" : ""}`}>{m.text}</p>

                {m.plan && (
                  <div className="mt-4 border-t border-line pt-4">
                    <h2 className="text-xl font-bold tracking-tight">{m.plan.name}</h2>
                    <p className="mt-1 text-sm text-muted">{m.plan.description}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {m.plan.toolkits.map((t) => {
                        const logo = toolkitLogo(t, 32);
                        return (
                          <span key={t} className="inline-flex items-center gap-1.5 rounded-lg bg-ground px-2.5 py-1 font-mono text-xs ring-1 ring-line">
                            {logo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={logo} alt="" className="size-4 rounded-[3px]" />
                            )}
                            {t}
                          </span>
                        );
                      })}
                      <span className="rounded-lg bg-accent-soft px-2.5 py-1 font-mono text-xs text-accent-dark">
                        ⏰ {m.plan.trigger_summary}
                      </span>
                    </div>

                    <ol className="mt-4 space-y-2">
                      {m.plan.steps.map((s, j) => (
                        <li key={j} className="flex gap-3 text-sm leading-relaxed">
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10px] font-bold text-accent-dark">
                            {j + 1}
                          </span>
                          {s}
                        </li>
                      ))}
                    </ol>

                    {m.plan.procedure && m.plan.procedure.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink">
                          ⚙ Under the hood — exact operations ({m.plan.procedure.length})
                        </summary>
                        <ol className="mt-2 space-y-1.5 rounded-xl bg-ground p-3 ring-1 ring-line">
                          {m.plan.procedure.map((p, j) => (
                            <li key={j} className="flex gap-2 font-mono text-[11px] leading-relaxed text-ink/80">
                              <span className="shrink-0 text-muted">{j + 1}.</span>
                              <span>
                                <span className="font-bold">{p.tool}</span> — {p.purpose}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {m.plan.limitations && m.plan.limitations.length > 0 && (
                      <div className="mt-4 rounded-xl border border-line bg-ground px-4 py-3">
                        <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-muted">
                          📋 One-time setup so this works perfectly
                        </p>
                        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
                          {m.plan.limitations.map((l, j) => (
                            <li key={j} className="flex gap-2">
                              <span className="text-accent-dark">→</span>
                              {l}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-muted">
                          Done with one of these? Just tell me below — e.g. &ldquo;created the template, it&apos;s called Daily Verse&rdquo;.
                        </p>
                      </div>
                    )}

                    {i === latestPlanIndex && (
                      <div className="mt-5 border-t border-line pt-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={approve}
                            disabled={saving || thinking !== null}
                            className="rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-ground transition hover:bg-ink/85 disabled:opacity-50"
                          >
                            {saving
                              ? editId
                                ? "Updating…"
                                : "Creating…"
                              : editId
                                ? "✓ Save updated agent"
                                : "✓ Approve plan → connect accounts"}
                          </button>
                          <span className="text-xs text-muted">or keep chatting below to adjust</span>
                        </div>
                        <div className="mt-3 flex items-center gap-4">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                            <input
                              type="radio"
                              checked={visibility === "private"}
                              onChange={() => setVisibility("private")}
                              className="accent-[#f4490c]"
                            />
                            🔒 Private
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                            <input
                              type="radio"
                              checked={visibility === "public"}
                              onChange={() => setVisibility("public")}
                              className="accent-[#f4490c]"
                            />
                            🌍 Public template
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        )}

        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-line bg-panel px-4 py-3 shadow-sm">
              <Thinking stages={thinking === "draft" ? DRAFT_STAGES : REFINE_STAGES} tick={tick} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-4 mt-6">
        <div className="flex gap-2 rounded-2xl border border-line bg-panel p-2 shadow-lg">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            disabled={thinking !== null || saving}
            placeholder={
              plan?.limitations?.length
                ? "Reply — e.g. “Done, my template is called Daily Verse”"
                : "Ask for changes — e.g. “also send me a Slack summary after it posts”"
            }
            className="w-full rounded-xl bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted/60 disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={thinking !== null || saving || input.trim().length < 3}
            className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-white transition hover:bg-accent-dark disabled:opacity-40"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
