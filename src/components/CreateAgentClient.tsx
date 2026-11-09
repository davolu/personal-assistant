"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toolkitLogo } from "@/lib/toolkits";
import type { AgentPlan } from "@/lib/planner";

const EXAMPLES = [
  "When a client hasn't paid an invoice after 7 days, send them a polite reminder email and keep nudging weekly",
  "Every morning, summarize my unread emails and post the summary to my Slack",
  "When someone books a call on my Calendly, research them and send me a prep note",
];

export default function CreateAgentClient({
  initialIdea = "",
  editId,
}: {
  initialIdea?: string;
  editId?: string;
}) {
  const router = useRouter();
  const [idea, setIdea] = useState(initialIdea);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState<"plan" | "refine" | "save" | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refined, setRefined] = useState(false);

  async function refine() {
    if (!plan || feedback.trim().length < 3) return;
    setBusy("refine");
    setError("");
    try {
      const res = await fetch("/api/create/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, plan, feedback }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Couldn't update the plan — try again.");
      else {
        setPlan(json.plan);
        setFeedback("");
        setRefined(true);
      }
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("plan");
    setError("");
    setRefined(false);
    const res = await fetch("/api/create/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(res.status === 401 ? "Sign in first — then come back and create your agent." : json.error);
      return;
    }
    setPlan(json.plan);
  }

  async function accept() {
    if (!plan) return;
    setBusy("save");
    setError("");
    const res = await fetch("/api/create/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, visibility, idea, editId }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(json.error);
      return;
    }
    router.push(json.connect);
  }

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
        onClick={generate}
        disabled={busy !== null || idea.trim().length < 10}
        className="mt-5 w-full rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark disabled:opacity-50"
      >
        {busy === "plan" ? "Drafting your workflow…" : plan ? "Regenerate plan" : editId ? "✨ Regenerate from this description" : "✨ Draft my agent"}
      </button>

      {error && <p className="mt-3 text-sm text-accent-dark">{error}</p>}

      {plan && (
        <div className="mt-8 rounded-2xl border border-line bg-panel p-6 shadow-sm">
          <p className="font-mono text-[11px] uppercase tracking-widest text-accent-dark">Proposed agent</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{plan.name}</h2>
          <p className="mt-1 text-muted">{plan.description}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {plan.toolkits.map((t) => {
              const logo = toolkitLogo(t, 32);
              return (
                <span key={t} className="inline-flex items-center gap-1.5 rounded-lg bg-ground px-3 py-1.5 font-mono text-xs ring-1 ring-line">
                  {logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="size-4 rounded-[3px]" />
                  )}
                  {t}
                </span>
              );
            })}
            <span className="rounded-lg bg-accent-soft px-3 py-1.5 font-mono text-xs text-accent-dark">
              ⏰ {plan.trigger_summary}
            </span>
          </div>

          <ol className="mt-5 space-y-2.5">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10px] font-bold text-accent-dark">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>

          {plan.procedure && plan.procedure.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink">
                ⚙ Under the hood — exact operations it will run ({plan.procedure.length})
              </summary>
              <ol className="mt-2 space-y-1.5 rounded-xl bg-ground p-3 ring-1 ring-line">
                {plan.procedure.map((p, i) => (
                  <li key={i} className="flex gap-2 font-mono text-[11px] leading-relaxed text-ink/80">
                    <span className="shrink-0 text-muted">{i + 1}.</span>
                    <span>
                      <span className="font-bold">{p.tool}</span> — {p.purpose}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {plan.limitations && plan.limitations.length > 0 && (
            <div className="mt-5 rounded-xl border border-line bg-ground px-4 py-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-muted">
                📋 One-time setup so this works perfectly
              </p>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
                {plan.limitations.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent-dark">→</span>
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-muted">
              💬 Chat with the plan — adjust anything, or report setup you&apos;ve done
            </p>
            {refined && (
              <p className="mt-2 rounded-lg bg-mint-soft px-3 py-1.5 text-xs font-medium text-mint">
                ✓ Plan updated with your note
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") refine();
                }}
                placeholder={
                  plan.limitations && plan.limitations.length > 0
                    ? "e.g. Done — I created the template, it's called 'Daily Verse'"
                    : "e.g. Also send me a Slack message after it posts"
                }
                className="w-full rounded-xl border border-line bg-ground px-4 py-2.5 text-sm outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <button
                onClick={refine}
                disabled={busy !== null || feedback.trim().length < 3}
                className="shrink-0 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-semibold transition hover:border-ink/30 disabled:opacity-50"
              >
                {busy === "refine" ? "Updating…" : "Update plan"}
              </button>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4 border-t border-line pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
                className="accent-[#f4490c]"
              />
              🔒 Private — only you
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
                className="accent-[#f4490c]"
              />
              🌍 Public template — share with the community
            </label>
          </div>

          <button
            onClick={accept}
            disabled={busy !== null}
            className="mt-5 w-full rounded-xl bg-ink py-3.5 font-semibold text-ground transition hover:bg-ink/85 disabled:opacity-50"
          >
            {busy === "save" ? (editId ? "Updating…" : "Creating…") : editId ? "Save updated agent" : "Accept plan → connect accounts"}
          </button>
        </div>
      )}
    </div>
  );
}
