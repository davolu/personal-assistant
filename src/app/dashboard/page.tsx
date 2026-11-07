import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { NGN_RATE } from "@/lib/billing";
import { PLANS, type PlanKey, type TierKey } from "@/lib/site";
import { getBot } from "@/lib/agents";
import TierBadge from "@/components/TierBadge";
import { toolkitLogo } from "@/lib/toolkits";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(props: { searchParams: Promise<{ hired?: string; plan?: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}

async function DashboardContent({
  searchParams,
}: {
  searchParams: Promise<{ hired?: string; plan?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/signin?next=/dashboard");
  const { hired, plan: upgraded } = await searchParams;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    include: {
      hiredAgents: { where: { status: "active" }, orderBy: { createdAt: "desc" } },
      connections: true,
      customAgents: true,
      runLogs: { orderBy: { startedAt: "desc" }, take: 10, include: { agent: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  const plan = (user.plan in PLANS ? user.plan : "free") as PlanKey;
  const planMeta = PLANS[plan];
  const runsPct = Math.min(100, Math.round((user.runsUsed / Math.max(1, user.runsQuota)) * 100));
  const connectedSet = new Set(user.connections.filter((c) => c.status === "active").map((c) => c.toolkit));

  const agentToolkits = (slug: string): string[] => {
    if (slug.startsWith("custom-")) {
      const c = user.customAgents.find((c) => `custom-${c.id}` === slug);
      return c?.toolkits ?? [];
    }
    return getBot(slug)?.toolkits ?? [];
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/create" className="rounded-xl border border-line bg-panel px-5 py-3 font-semibold transition hover:border-ink/30">
            ✨ Create agent
          </Link>
          <Link href="/agents" className="rounded-xl bg-accent px-5 py-3 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark">
            + Add from templates
          </Link>
        </div>
      </div>

      {hired && (
        <p className="mt-5 rounded-xl bg-mint-soft px-4 py-3 text-sm font-medium text-mint">
          🎉 Agent added! Connect its tools below and it&apos;s ready to run.
        </p>
      )}
      {upgraded && upgraded in PLANS && (
        <p className="mt-5 rounded-xl bg-mint-soft px-4 py-3 text-sm font-medium text-mint">
          🎉 You&apos;re on the {PLANS[upgraded as PlanKey].label} plan — {PLANS[upgraded as PlanKey].runs.toLocaleString()} runs/month.
        </p>
      )}

      {/* Plan & runs */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-panel p-5 sm:col-span-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
              {planMeta.label} plan · runs this month
            </p>
            {plan === "free" ? (
              <Link href="/pricing" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-white hover:bg-accent-dark">
                Upgrade
              </Link>
            ) : (
              <span className="font-mono text-[11px] text-muted">
                ${planMeta.price}/mo{user.cardLast4 ? ` · card •••• ${user.cardLast4}` : ""}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">{user.runsUsed.toLocaleString()}</span>
            <span className="text-muted">/ {user.runsQuota.toLocaleString()} runs</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ground ring-1 ring-line">
            <div
              className={`h-full rounded-full ${runsPct > 85 ? "bg-accent" : "bg-mint"}`}
              style={{ width: `${runsPct}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">
            {user.nextBillingAt
              ? `Resets ${user.nextBillingAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
              : "Resets monthly"}
            {plan !== "free" && ` · ≈ ₦${Math.round(planMeta.price * NGN_RATE).toLocaleString()}/mo`}
            {" · top-up $3 per 1,000 runs"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-panel p-5">
          <p className="font-mono text-[11px] uppercase tracking-wide text-muted">Connected apps</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{connectedSet.size}</p>
          <Link href="/apps" className="mt-1 inline-block text-xs font-semibold text-accent-dark hover:underline">
            Browse all supported apps →
          </Link>
        </div>
      </div>

      {/* Agents */}
      <h2 className="mt-12 text-2xl font-bold tracking-tight">
        Your agents <span className="font-mono text-sm font-normal text-muted">({user.hiredAgents.length})</span>
      </h2>
      {user.hiredAgents.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line bg-panel p-12 text-center">
          <p className="text-lg font-semibold">No agents yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            Pick from over 1,000 ready templates, or describe your own in plain language.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link href="/agents" className="rounded-xl bg-accent px-6 py-3 font-semibold text-white transition hover:bg-accent-dark">
              Browse templates
            </Link>
            <Link href="/create" className="rounded-xl border border-line px-6 py-3 font-semibold transition hover:border-ink/30">
              ✨ Create your own
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {user.hiredAgents.map((a) => {
            const toolkits = agentToolkits(a.slug);
            const missing = toolkits.filter((t) => !connectedSet.has(t));
            const ready = missing.length === 0 && toolkits.length > 0;
            const custom = a.slug.startsWith("custom-");
            return (
              <div key={a.id} className="flex flex-col rounded-xl border border-line bg-panel p-5 transition hover:border-accent/40">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/dashboard/agents/${a.id}`} className="font-semibold leading-snug hover:text-accent-dark">
                    {a.name} <span className="font-mono text-xs font-normal text-muted">→</span>
                  </Link>
                  {custom ? (
                    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent-dark">
                      ✨ Custom
                    </span>
                  ) : (
                    <TierBadge tier={a.tier as TierKey} />
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {toolkits.map((t) => {
                    const logo = toolkitLogo(t, 32);
                    const ok = connectedSet.has(t);
                    return (
                      <span
                        key={t}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 ${
                          ok ? "bg-mint-soft text-mint ring-mint/20" : "bg-ground text-muted ring-line"
                        }`}
                      >
                        {logo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt="" className="size-3 rounded-[2px]" />
                        )}
                        {t} {ok ? "✓" : ""}
                      </span>
                    );
                  })}
                </div>
                <p className="mt-3 font-mono text-[11px] text-muted">
                  {a.runsUsed} run{a.runsUsed === 1 ? "" : "s"} ·{" "}
                  {a.lastRunAt
                    ? `last ran ${a.lastRunAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                    : "hasn't run yet"}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  {ready ? (
                    <>
                      <span className="rounded-md bg-mint-soft px-2 py-1 font-mono text-[11px] font-semibold text-mint">
                        ● Ready · runs {a.schedule}
                      </span>
                      <form action="/api/agents/run" method="POST">
                        <input type="hidden" name="agentId" value={a.id} />
                        <button className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-ground transition hover:bg-ink/85">
                          ▶ Run now
                        </button>
                      </form>
                    </>
                  ) : (
                    <Link
                      href={`/connect/${a.slug}`}
                      className="rounded-md bg-gold-soft px-2 py-1 font-mono text-[11px] font-semibold text-gold hover:underline"
                    >
                      ⚠ Connect {missing.length} app{missing.length === 1 ? "" : "s"} →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity log */}
      <h2 className="mt-12 text-2xl font-bold tracking-tight">Recent activity</h2>
      {user.runLogs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-panel px-5 py-8 text-center text-sm text-muted">
          No runs yet — once your agents start running, every run shows up here with what it did.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
          {user.runLogs.map((r) => (
            <details key={r.id} className="group border-b border-line last:border-0">
              <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm hover:bg-ground/60">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.agent.name} <span className="font-mono text-xs text-muted">· {r.trigger}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted">{r.summary || "—"}</p>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className={`font-mono text-xs font-semibold ${r.status === "success" ? "text-mint" : r.status === "error" ? "text-accent-dark" : "text-gold"}`}>
                    {r.status}
                  </p>
                  <p className="font-mono text-[11px] text-muted">
                    {r.startedAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </summary>
              <div className="border-t border-line bg-ground/40 px-5 py-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{r.summary || "No summary recorded."}</p>
                <Link
                  href={`/dashboard/agents/${r.agentId}`}
                  className="mt-3 inline-block font-mono text-xs font-semibold text-accent-dark hover:underline"
                >
                  View agent details &amp; full history →
                </Link>
              </div>
            </details>
          ))}
        </div>
      )}

      {/* Recent payments */}
      {user.payments.length > 0 && (
        <>
          <h2 className="mt-12 text-2xl font-bold tracking-tight">Recent payments</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
            {user.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-line px-5 py-3 text-sm last:border-0">
                <div>
                  <p className="font-medium">{p.description}</p>
                  <p className="font-mono text-xs text-muted">
                    {p.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {p.reference}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">₦{(p.amountKobo / 100).toLocaleString()}</p>
                  <p className={`font-mono text-xs ${p.status === "success" ? "text-mint" : p.status === "failed" ? "text-accent-dark" : "text-muted"}`}>
                    {p.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
