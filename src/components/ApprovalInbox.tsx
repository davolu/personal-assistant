"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { copyText, mutate } from "@/lib/mutate";

type PendingApproval = {
  id: string;
  agentName: string;
  tool: string;
  args: string;
  createdAt: string;
};

export default function ApprovalInbox({ approvals }: { approvals: PendingApproval[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function resolve(id: string, action: "approve" | "reject") {
    let reason: string | undefined;
    if (action === "reject") {
      const input = window.prompt("Why reject? (optional — the agent learns from this)");
      if (input === null) return; // cancelled
      reason = input || undefined;
    }
    setBusy(id);
    setError("");
    const res = await mutate("/api/approvals/resolve", {
      method: "POST",
      body: { approvalId: id, action, reason },
      success: action === "approve" ? "Approved" : "Rejected",
      failure: "Something went wrong — try again.",
    });
    if (!res.ok) setError(res.error || "Something went wrong — try again.");
    else router.refresh();
    setBusy(null);
  }

  function prettyTool(tool: string) {
    return tool.replace(/^[A-Z0-9]+?_/, "").replace(/_/g, " ").toLowerCase();
  }

  function prettyArgs(args: string) {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gold/40 bg-gold-soft/40">
      {error && <p className="px-5 pt-3 text-sm font-medium text-accent-dark">{error}</p>}
      {approvals.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line/60 px-5 py-4 last:border-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {a.agentName} <span className="font-normal text-muted">wants to</span>{" "}
              <span className="font-mono text-[13px]">{prettyTool(a.tool)}</span>
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer font-mono text-[11px] text-muted hover:text-ink">
                view exact payload
              </summary>
              <div className="mt-2">
                <button type="button" className="min-h-11 px-1 text-xs font-semibold text-ink" onClick={() => void copyText(prettyArgs(a.args))}>
                  Copy
                </button>
                <pre className="max-h-48 overflow-auto rounded-lg bg-ground p-3 font-mono text-[11px] leading-relaxed text-ink/90 ring-1 ring-line">
                  {prettyArgs(a.args)}
                </pre>
              </div>
            </details>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => resolve(a.id, "approve")}
              disabled={busy === a.id}
              className="rounded-lg bg-mint px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === a.id ? "Running…" : "✓ Approve — run continues"}
            </button>
            <button
              onClick={() => resolve(a.id, "reject")}
              disabled={busy === a.id}
              className="rounded-lg border border-line bg-panel px-4 py-2 text-sm font-semibold text-accent-dark transition hover:border-accent-dark/40 disabled:opacity-50"
            >
              ✗ Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
