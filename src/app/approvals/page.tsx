"use client";

import { useEffect, useState } from "react";
import { approvalTitle } from "@/assistant/approval-copy";
import { readableError } from "@/lib/readable-error";
import { EmptyArt } from "@/components/illustrations";

type Approval = { id: string; tool: string; args: unknown; expiresAt: string };

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/assistant/approvals")
      .then(async (res) => {
        if (res.status === 401) {
          setError("Sign in to see approvals.");
          setApprovals([]);
          return;
        }
        const json = (await res.json()) as { approvals?: Approval[]; error?: string };
        if (!res.ok) setError(readableError(json.error, "Could not load approvals."));
        setApprovals(json.approvals ?? []);
      })
      .catch(() => setError("Could not load approvals."));
  }, []);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <p className="kicker">Inbox</p>
      <h1 className="mt-2 text-3xl font-bold">Approvals</h1>
      <p className="mt-2 text-sm text-muted">Sends, deletes, and payments wait here until you approve the exact action.</p>
      {error && <p className="mt-4 text-sm text-accent-dark">{error}</p>}
      <ul className="mt-4 space-y-3">
        {(approvals ?? []).map((approval) => (
          <li key={approval.id} className="surface p-4">
            <p className="font-semibold">{approvalTitle(approval.tool)}</p>
            <p className="mt-1 break-all font-mono text-xs text-muted">{JSON.stringify(approval.args)}</p>
          </li>
        ))}
      </ul>
      {approvals?.length === 0 && !error && (
        <div className="surface mt-6 px-5 py-8 text-center">
          <EmptyArt kind="approvals" />
          <p className="mt-2 text-sm text-muted">Nothing is waiting.</p>
        </div>
      )}
    </div>
  );
}
