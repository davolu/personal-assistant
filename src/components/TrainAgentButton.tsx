"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { streamRun, type RunEvent } from "@/lib/run-stream";
import LiveRunFeed from "@/components/LiveRunFeed";

const MAX_ATTEMPTS = 3;

// "waiting" can't occur in training (approval gate is off), but the finish event type includes it.
type Attempt = { n: number; status: "running" | "success" | "error" | "waiting"; summary: string; events: RunEvent[] };

/**
 * Training mode (create/edit funnel only): the agent attempts its job for
 * real; after each failed attempt it reflects, updates its memory, and the
 * next attempt is explicitly steered away from what just failed.
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
      setAttempts((a) => [...a, { n, status: "running", summary: "", events: [] }]);
      const finish = await streamRun(
        agentId,
        true,
        (ev) => setAttempts((a) => a.map((x) => (x.n === n ? { ...x, events: [...x.events, ev] } : x))),
        n
      );
      setAttempts((a) =>
        a.map((x) => (x.n === n ? { ...x, status: finish.status, summary: finish.summary } : x))
      );
      router.refresh();

      if (finish.status === "success") {
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
        Runs the job for real, learns from each failure, retries differently — up to {MAX_ATTEMPTS} attempts (each uses 1 run)
      </p>

      {attempts.length > 0 && (
        <div className="mt-4 space-y-3">
          {attempts.map((a) => (
            <div key={a.n} className="rounded-xl border border-line bg-panel p-4">
              <div className="flex items-center gap-3">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-xs font-bold ${
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
                <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Attempt {a.n}
                  {a.status === "error" && a.n < MAX_ATTEMPTS ? " — learning from this, retrying differently…" : ""}
                </p>
              </div>
              <div className="mt-3">
                <LiveRunFeed events={a.events} />
              </div>
              {a.summary && (
                <p className={`mt-2 text-sm leading-snug ${a.status === "success" ? "text-mint" : "text-ink/90"}`}>
                  {a.summary}
                </p>
              )}
            </div>
          ))}
          {verdict === "trained" && (
            <p className="rounded-xl bg-mint-soft px-4 py-3 text-sm font-semibold text-mint">
              🎓 Trained — it completed the job and saved what it learned for every future run.
            </p>
          )}
          {verdict === "needs_help" && (
            <p className="rounded-xl bg-gold-soft px-4 py-3 text-sm text-gold">
              Still failing after {MAX_ATTEMPTS} attempts — the ✗ lines above show the blocker
              (often a resource the connection can&apos;t access). Its lessons are saved; fix the
              blocker and train again to pick up where it left off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
