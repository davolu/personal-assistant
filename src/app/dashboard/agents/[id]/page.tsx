import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { connectionListSelect, guardQuery } from "@/lib/db-error";
import DataUnavailable from "@/components/DataUnavailable";
import { getBot } from "@/lib/agents";
import TierBadge from "@/components/TierBadge";
import DeleteAgentButton from "@/components/DeleteAgentButton";
import ScheduleSelect from "@/components/ScheduleSelect";
import RunNowButton from "@/components/RunNowButton";
import { toolkitLogo } from "@/lib/toolkits";
import { EVENT_TRIGGERS, eventToolkitsOf } from "@/lib/triggers";
import ApprovalModeToggle from "@/components/ApprovalModeToggle";
import type { TierKey } from "@/lib/site";

export const metadata: Metadata = { title: "Agent details" };

export default function AgentDetailsPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <AgentDetails {...props} />
    </Suspense>
  );
}

async function AgentDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/signin?next=/dashboard");

  const loaded = await guardQuery(async () => {
    const agent = await prisma.hiredAgent.findFirst({
      where: { id, userId: session.user.id },
      include: { runLogs: { orderBy: { startedAt: "desc" }, take: 50 } },
    });
    if (!agent) return null;
    const custom = agent.slug.startsWith("custom-")
      ? await prisma.customAgent.findFirst({
          where: { id: agent.slug.replace(/^custom-/, ""), userId: session.user.id },
        })
      : null;
    const toolkits = custom?.toolkits ?? getBot(agent.slug)?.toolkits ?? [];
    const connections = await prisma.connection.findMany({
      where: { userId: session.user.id, toolkit: { in: toolkits } },
      select: connectionListSelect,
    });
    return { agent, custom, connections };
  });
  if (!loaded.ok) return <DataUnavailable detail={loaded.detail} />;
  if (!loaded.value) notFound();
  const { agent, custom, connections } = loaded.value;
  const bot = custom ? null : getBot(agent.slug);

  const toolkits = custom?.toolkits ?? bot?.toolkits ?? [];
  const description = custom?.description ?? bot?.desc ?? "";
  const steps = custom?.steps ?? bot?.steps ?? [];
  const statusOf = (t: string) => connections.find((c) => c.toolkit === t)?.status ?? "none";
  const ready = toolkits.length > 0 && toolkits.every((t) => statusOf(t) === "active");

  const ok = agent.runLogs.filter((r) => r.status === "success").length;
  const failed = agent.runLogs.filter((r) => r.status === "error").length;

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <nav className="font-mono text-xs text-muted">
        <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{agent.name}</span>
      </nav>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{agent.name}</h1>
            {custom ? (
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent-dark">
                ✨ Custom
              </span>
            ) : (
              <TierBadge tier={agent.tier as TierKey} />
            )}
          </div>
          <p className="mt-2 max-w-xl text-muted">{description}{description.endsWith(".") ? "" : "."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
            <ApprovalModeToggle agentId={agent.id} mode={agent.approvalMode} />
            <ScheduleSelect
              agentId={agent.id}
              schedule={agent.schedule}
              eventCapable={eventToolkitsOf(toolkits).length > 0}
              eventHint={eventToolkitsOf(toolkits)
                .map((t) => EVENT_TRIGGERS[t].label)
                .join(" or ")}
            />
            <span>
              · added {agent.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {custom && ` · ${custom.visibility === "public" ? "shared" : "private"}`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {agent.status === "draft" ? (
            <Link
              href={`/connect/${agent.slug}`}
              className="rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark"
            >
              🎓 Finish training to go live →
            </Link>
          ) : (
            ready && <RunNowButton agentId={agent.id} size="lg" />
          )}
          <DeleteAgentButton agentId={agent.id} name={agent.name} />
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-panel text-center">
        <div className="p-5">
          <p className="text-2xl font-bold tracking-tight">{agent.runsUsed}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">total runs</p>
        </div>
        <div className="p-5">
          <p className="text-2xl font-bold tracking-tight text-mint">{ok}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">succeeded</p>
        </div>
        <div className="p-5">
          <p className="text-2xl font-bold tracking-tight text-accent-dark">{failed}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">failed</p>
        </div>
      </div>

      {/* Connected apps */}
      <h2 className="mt-10 text-xl font-bold tracking-tight">Connected apps</h2>
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
        {toolkits.map((t) => {
          const st = statusOf(t);
          const logo = toolkitLogo(t, 64);
          return (
            <div key={t} className="flex items-center justify-between border-b border-line px-5 py-3.5 last:border-0">
              <div className="flex items-center gap-3">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-5 rounded-md" />
                ) : (
                  <span className="grid size-5 place-items-center rounded-md bg-line text-[10px] font-bold">{t[0]}</span>
                )}
                <span className="font-semibold">{t}</span>
              </div>
              {st === "active" ? (
                <span className="rounded-full bg-mint-soft px-3 py-1 font-mono text-xs font-semibold text-mint">✓ Connected</span>
              ) : (
                <Link
                  href={`/connect/${agent.slug}`}
                  className="rounded-full bg-gold-soft px-3 py-1 font-mono text-xs font-semibold text-gold hover:underline"
                >
                  Connect →
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Workflow */}
      {steps.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-bold tracking-tight">Workflow</h2>
          <ol className="mt-4 space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink/90">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10px] font-bold text-accent-dark">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </>
      )}

      {/* Run history */}
      <h2 className="mt-10 text-xl font-bold tracking-tight">Run history</h2>
      {agent.runLogs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-panel px-5 py-8 text-center text-sm text-muted">
          No runs yet{ready ? " — hit Run now to try it." : " — connect its apps first."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {agent.runLogs.map((r) => {
            const secs = r.finishedAt ? ((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(0) : null;
            return (
              <details key={r.id} className="group rounded-xl border border-line bg-panel open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.summary || "—"}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {r.startedAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {" · "}{r.trigger}{secs ? ` · ${secs}s` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 font-mono text-xs font-semibold ${
                      r.status === "success"
                        ? "bg-mint-soft text-mint"
                        : r.status === "error"
                          ? "bg-accent-soft text-accent-dark"
                          : "bg-gold-soft text-gold"
                    }`}
                  >
                    {r.status}
                  </span>
                </summary>
                <div className="border-t border-line px-5 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{r.summary || "No summary recorded."}</p>
                  {Array.isArray(r.trace) && r.trace.length > 0 && (
                    <div className="mt-4">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Tool calls ({r.trace.length})
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(r.trace as { tool: string; ok: boolean; error?: string; args?: string }[]).map((t, i) => (
                          <span
                            key={i}
                            title={[t.args, t.error].filter(Boolean).join(" → ")}
                            className={`rounded-md px-2 py-1 font-mono text-[11px] ring-1 ${
                              t.ok ? "bg-mint-soft text-mint ring-mint/20" : "bg-accent-soft text-accent-dark ring-accent/20"
                            }`}
                          >
                            {t.ok ? "✓" : "✗"} {t.tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {Array.isArray(r.trace) && r.trace.length === 0 && r.status === "success" && (
                    <p className="mt-3 rounded-md bg-gold-soft px-2 py-1 font-mono text-[11px] text-gold">
                      ⚠ No tools were called in this run — treat its claims with suspicion.
                    </p>
                  )}
                  <p className="mt-3 font-mono text-[11px] text-muted">
                    Run {r.id} · started {r.startedAt.toLocaleString("en-GB")}
                    {r.finishedAt ? ` · finished ${r.finishedAt.toLocaleString("en-GB")}` : " · still running"}
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
