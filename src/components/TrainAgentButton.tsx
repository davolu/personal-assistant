"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_ATTEMPTS = 3;

type Attempt = { n: number; status: "running" | "success" | "error"; summary: string };

/**
 * Training mode: the agent attempts its job for real; after each failed
 * attempt it reflects, updates its memory, and retries with those lessons —
 * until it succeeds or hits the attempt limit.
 */
export default function TrainAgentButton({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<"" | "trained" | "needs_help">("");

  async function train() {
    setBusy(true);
    setVerdict("");
    setAttempts([]);

    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      setAttempts((a) => [...a, { n, status: "running", summary: "Attempting the job…" }]);
      let status: "success" | "error" = "error";
      let summary = "Request failed — network or server error.";
      try {
        const res = await fetch("/api/agents/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, training: true }),
        });
        const json = await res.json();
        status = res.ok && json.status === "success" ? "success" : "error";
        summary = json.summary || summary;
      } catch {
        /* keep defaults */
      }
      setAttempts((a) => a.map((x) => (x.n === n ? { ...x, status, summary } : x)));
      router.refresh();

      if (status === "success") {
        setVerdict("trained");
        setBusy(false);
        return;
      }
    }
    setVerdict("needs_help");
    setBusy(false);
  }

  return (
    <div className="w-full">
      <button
        onClick={train}
        disabled={busy}
        className="w-full rounded-xl border-2 border-ink bg-panel px-6 py-3 font-semibold transition hover:bg-ground disabled:opacity-70"
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Training — attempt {attempts.length}/{MAX_ATTEMPTS}…
          </span>
        ) : (
          <>🎓 Train this agent</>
        )}
      </button>
      <p className="mt-1.5 text-center font-mono text-[11px] text-muted">
        Runs the job for real, learns from each failure, retries — up to {MAX_ATTEMPTS} attempts (each uses 1 run)
      </p>

      {attempts.length > 0 && (
        <div className="mt-4 space-y-2">
          {attempts.map((a) => (
            <div key={a.n} className="flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${
                  a.status === "running"
                    ? "bg-gold-soft text-gold"
                    : a.status === "success"
                      ? "bg-mint-soft text-mint"
                      : "bg-accent-soft text-accent-dark"
                }`}
              >
                {a.status === "running" ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : a.status === "success" ? (
                  "✓"
                ) : (
                  "✗"
                )}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Attempt {a.n}
                  {a.status === "error" && a.n < MAX_ATTEMPTS ? " — learning from this, retrying…" : ""}
                </p>
                <p className="mt-0.5 leading-snug text-ink/90">{a.summary}</p>
              </div>
            </div>
          ))}
          {verdict === "trained" && (
            <p className="rounded-xl bg-mint-soft px-4 py-3 text-sm font-semibold text-mint">
              🎓 Trained — it completed the job and saved what it learned for every future run.
            </p>
          )}
          {verdict === "needs_help" && (
            <p className="rounded-xl bg-gold-soft px-4 py-3 text-sm text-gold">
              Still failing after {MAX_ATTEMPTS} attempts — check the run history below: the tool
              chips usually point at the blocker (often a missing connection or a resource it
              can&apos;t access). Its lessons are saved, so fixing the blocker and training again
              picks up where it left off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
