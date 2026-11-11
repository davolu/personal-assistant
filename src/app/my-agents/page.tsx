"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AgentRow = {
  id: string;
  name: string;
  request: string;
  cadence: string;
  timezone: string;
  paused: boolean;
  lastStatus: string;
  lastRunAt: string | null;
};

export default function MyAgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/assistant/agents");
    const json = (await res.json().catch(() => ({}))) as { agents?: AgentRow[]; error?: string };
    if (!res.ok) setError(json.error || "Could not load agents");
    else setAgents(json.agents ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(id: string, body: { paused?: boolean; cadence?: string }) {
    await fetch(`/api/assistant/agents/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">From chat</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">My agents</h1>
        </div>
        <Link href="/chat" className="text-sm font-semibold text-accent-dark">
          Back to chat
        </Link>
      </div>
      {error && <p className="mt-4 text-sm text-accent-dark">{error}</p>}
      <ul className="mt-6 space-y-3">
        {agents.length === 0 && <li className="text-muted">Saved workflows show up here after a chat run succeeds.</li>}
        {agents.map((agent) => (
          <li key={agent.id} className="rounded-2xl border border-line bg-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{agent.name}</h2>
                <p className="mt-1 text-sm text-muted">{agent.request}</p>
                <p className="mt-2 font-mono text-xs text-muted">
                  {agent.paused ? "paused" : agent.cadence} · {agent.timezone}
                  {agent.lastStatus ? ` · last ${agent.lastStatus}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => void fetch(`/api/assistant/agents/${agent.id}/run`, { method: "POST" }).then(load)}>
                  Run now
                </button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => void patch(agent.id, { paused: !agent.paused })}>
                  {agent.paused ? "Resume" : "Pause"}
                </button>
                <select className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm" value={agent.cadence} onChange={(event) => void patch(agent.id, { cadence: event.target.value })}>
                  <option value="manual">Manual</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                <button className="rounded-lg border border-line px-3 py-1.5 text-sm" onClick={() => void fetch(`/api/assistant/agents/${agent.id}`, { method: "DELETE" }).then(load)}>
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
