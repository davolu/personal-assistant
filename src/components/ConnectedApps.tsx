"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "@/lib/mutate";

export default function ConnectedApps({
  apps,
}: {
  apps: { toolkit: string; logo: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function disconnect(toolkit: string) {
    if (
      !window.confirm(
        `Disconnect ${toolkit}? Agents that use it will skip their runs until you reconnect it.`
      )
    )
      return;
    setBusy(toolkit);
    const res = await mutate("/api/connections/disconnect", {
      method: "POST",
      body: { toolkit },
      success: "Disconnected",
      failure: "Couldn't disconnect — try again.",
    });
    if (res.ok) router.refresh();
    setBusy(null);
  }

  if (apps.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {apps.map((a) => (
        <span
          key={a.toolkit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ground px-2 py-1 font-mono text-[11px]"
        >
          {a.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.logo} alt="" className="h-3.5 w-3.5 rounded-sm" />
          )}
          {a.toolkit}
          <button
            onClick={() => disconnect(a.toolkit)}
            disabled={busy === a.toolkit}
            title={`Disconnect ${a.toolkit}`}
            className="ml-0.5 text-muted transition hover:text-accent-dark disabled:opacity-50"
          >
            {busy === a.toolkit ? "…" : "✕"}
          </button>
        </span>
      ))}
    </div>
  );
}
