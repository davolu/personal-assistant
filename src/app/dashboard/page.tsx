import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { connectionListSelect, guardQuery } from "@/lib/db-error";
import DataUnavailable from "@/components/DataUnavailable";
import { NGN_RATE } from "@/lib/billing";
import { CREDIT_TOPUP, PLANS, type PlanKey } from "@/lib/site";
import { creditsExhaustedText, formatCredits, isLowBalance } from "@/lib/credits";
import { balanceOf, ensureUserCredits, recentUsage } from "@/lib/usage-store";
import { toolkitLogo } from "@/lib/toolkits";
import { EmptyArt } from "@/components/illustrations";
import ConnectedApps from "@/components/ConnectedApps";
import { UpgradeLink } from "@/components/UpgradeLink";
import ApprovalInbox from "@/components/ApprovalInbox";
import { describeCadence } from "@/agentic/cadence";
import type { ScheduleRecord } from "@/agentic/schedule-store";
import { toPublicSchedule } from "@/agentic/schedules";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(props: { searchParams: Promise<{ hired?: string; plan?: string; preview?: string; topup?: string }> }) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <DashboardContent {...props} />
    </Suspense>
  );
}

async function DashboardContent({
  searchParams,
}: {
  searchParams: Promise<{ hired?: string; plan?: string; preview?: string; topup?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  if ((params.preview === "1" || params.preview === "empty") && !session) {
    return <DashboardHome {...previewModel(params.preview === "empty")} />;
  }
  if (!session) redirect("/signin?next=/dashboard");

  const loaded = await guardQuery(async () => {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        hiredAgents: { where: { status: { in: ["active", "draft"] } }, orderBy: { createdAt: "desc" } },
        connections: { select: connectionListSelect },
        runLogs: { orderBy: { startedAt: "desc" }, take: 8, include: { agent: true } },
        payments: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!user) return null;
    const pendingApprovals = await prisma.approval.findMany({
      where: { userId: session.user.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { name: true } } },
    });
    return { user, pendingApprovals };
  });
  if (!loaded.ok) return <DataUnavailable detail={loaded.detail} />;
  if (!loaded.value) {
    return <DataUnavailable title="Account not found" detail="This session does not match a user row. Sign out and sign in again." />;
  }
  const { user, pendingApprovals } = loaded.value;
  const credited = await ensureUserCredits(user.id);
  const plan = (user.plan in PLANS ? user.plan : "free") as PlanKey;
  const planMeta = PLANS[plan];
  const remaining = credited ? balanceOf(credited) : 0;
  const usage = await recentUsage(user.id).catch(() => []);
  const connected = user.connections.filter((item) => item.status === "active").map((item) => item.toolkit);
  const chat = await loadChatHome(session.user.id);

  return (
    <DashboardHome
      firstName={user.name.split(" ")[0] || "there"}
      plan={plan}
      planLabel={planMeta.label}
      price={planMeta.price}
      creditsRemaining={remaining}
      creditsAllowance={planMeta.credits}
      topup={credited ? Number(credited.topupBalance) : 0}
      lowBalance={isLowBalance(remaining, planMeta.credits)}
      usage={usage}
      cardLast4={user.cardLast4}
      nextBilling={user.nextBillingAt ? user.nextBillingAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null}
      connected={[...new Set(connected)].sort().map((toolkit) => ({ toolkit, logo: toolkitLogo(toolkit, 32) }))}
      threads={chat.threads}
      schedules={chat.schedules}
      runs={[
        ...chat.runs,
        ...user.runLogs.map((run) => ({
          id: run.id,
          name: run.agent.name,
          status: run.status,
          summary: run.summary || "No summary recorded.",
          at: run.startedAt.toISOString(),
          href: `/dashboard/agents/${run.agentId}`,
        })),
      ]}
      approvals={pendingApprovals.map((approval) => ({
        id: approval.id,
        agentName: approval.agent.name,
        tool: approval.tool,
        args: approval.args,
        createdAt: approval.createdAt.toISOString(),
      }))}
      waiting={chat.waiting}
      hired={user.hiredAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        schedule: agent.schedule,
        status: agent.status,
        lastRun: agent.lastRunAt ? agent.lastRunAt.toISOString() : null,
      }))}
      payments={user.payments.map((payment) => ({
        id: payment.id,
        description: payment.description,
        when: payment.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
        reference: payment.reference,
        amount: `₦${(payment.amountKobo / 100).toLocaleString()}`,
        status: payment.status,
      }))}
      hiredBanner={Boolean(params.hired)}
      toppedUp={params.topup === "1"}
      upgraded={params.plan && params.plan in PLANS ? params.plan : null}
    />
  );
}

async function loadChatHome(userId: string) {
  const threads: { id: string; title: string; updatedAt: string }[] = [];
  const schedules: { id: string; name: string; cadenceLabel: string; nextRunAt: string | null; status: string; timezone: string }[] = [];
  const runs: DashModel["runs"] = [];
  const waiting: { id: string; name: string; summary: string; href: string }[] = [];
  try {
    const { listThreads } = await import("@/agentic/postgres");
    threads.push(...(await listThreads(userId)));
  } catch {
    // The dashboard still renders when chat storage is unavailable.
  }
  try {
    const { postgresScheduleStore } = await import("@/agentic/schedule-store");
    const store = postgresScheduleStore();
    if (store) {
      const rows = await store.list(userId);
      schedules.push(...rows.map(scheduleCard));
      const recent = await store.listRuns(userId, 8);
      for (const run of recent) {
        runs.push({
          id: run.id,
          name: run.name || "Scheduled run",
          status: run.status,
          summary: run.summary || "No summary yet.",
          at: run.startedAt,
          href: `/agentic-chat?thread=${encodeURIComponent(run.threadId)}`,
        });
        if (run.status === "waiting") {
          waiting.push({
            id: run.id,
            name: run.name || "Scheduled run",
            summary: run.summary || "This run is waiting for approval.",
            href: `/agentic-chat?thread=${encodeURIComponent(run.runThreadId)}`,
          });
        }
      }
    }
  } catch {
    // Missing schedule tables show an empty schedule list.
  }
  return { threads, schedules, runs, waiting };
}

function scheduleCard(row: ScheduleRecord) {
  const pub = toPublicSchedule(row);
  return { id: pub.id, name: pub.name, cadenceLabel: pub.cadenceLabel, nextRunAt: pub.nextRunAt, status: pub.status, timezone: pub.timezone };
}

type DashModel = {
  firstName: string;
  plan: PlanKey;
  planLabel: string;
  price: number;
  creditsRemaining: number;
  creditsAllowance: number;
  topup: number;
  lowBalance: boolean;
  usage: { id: string; type: string; credits: number; at: string }[];
  cardLast4: string | null;
  nextBilling: string | null;
  connected: { toolkit: string; logo: string | null }[];
  threads: { id: string; title: string; updatedAt: string }[];
  schedules: { id: string; name: string; cadenceLabel: string; nextRunAt: string | null; status: string; timezone: string }[];
  runs: { id: string; name: string; status: string; summary: string; at: string; href: string }[];
  approvals: { id: string; agentName: string; tool: string; args: string; createdAt: string }[];
  waiting: { id: string; name: string; summary: string; href: string }[];
  hired: { id: string; name: string; schedule: string; status: string; lastRun: string | null }[];
  payments: { id: string; description: string; when: string; reference: string; amount: string; status: string }[];
  hiredBanner: boolean;
  toppedUp: boolean;
  upgraded: string | null;
};

function DashboardHome(model: DashModel) {
  const spent = Math.max(0, model.creditsAllowance - Math.min(model.creditsAllowance, model.creditsRemaining));
  const runsPct = Math.min(100, Math.round((spent / Math.max(1, model.creditsAllowance)) * 100));
  const empty = model.creditsRemaining <= 0;
  return (
    <div data-dashboard className="mx-auto max-w-6xl px-4 py-4 sm:px-5 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker max-md:hidden">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl max-md:hidden">Welcome, {model.firstName}</h1>
          <p className="text-sm font-semibold md:hidden">Welcome, {model.firstName}</p>
        </div>
        <Link href="/agentic-chat" className="btn-ink">
          Open chat
        </Link>
      </div>

      {model.toppedUp && (
        <p className="mt-5 rounded-xl bg-mint-soft px-4 py-3 text-sm font-medium text-mint">Credits added. They stay on the account until you use them.</p>
      )}
      {model.hiredBanner && (
        <p className="mt-5 rounded-xl bg-mint-soft px-4 py-3 text-sm font-medium text-mint">Agent saved. Connect its tools below and it can run.</p>
      )}
      {empty && (
        <p className="mt-5 rounded-xl border border-coral/40 bg-coral/15 px-4 py-3 text-sm font-medium">
          {creditsExhaustedText()}{" "}
          <Link href="/pricing" className="font-semibold underline">Top up or upgrade</Link>
        </p>
      )}
      {model.lowBalance && !empty && (
        <p className="mt-5 rounded-xl border border-gold/40 bg-gold-soft px-4 py-3 text-sm font-medium">
          Credits are running low.{" "}
          <Link href="/pricing" className="font-semibold underline">Top up or upgrade</Link>
        </p>
      )}
      {model.upgraded && model.upgraded in PLANS && (
        <p className="mt-5 rounded-xl bg-mint-soft px-4 py-3 text-sm font-medium text-mint">
          You&apos;re on the {PLANS[model.upgraded as PlanKey].label} plan — {PLANS[model.upgraded as PlanKey].credits.toLocaleString()} credits/month.
        </p>
      )}

      <h2 className="mt-8 text-xl font-bold tracking-tight">
        Pending approvals <span className="font-mono text-sm font-normal text-muted">({model.approvals.length + model.waiting.length})</span>
      </h2>
      {model.approvals.length === 0 && model.waiting.length === 0 ? (
        <div className="surface mt-3 px-5 py-8 text-center">
          <EmptyArt kind="approvals" />
          <p className="mt-2 text-sm text-muted">Nothing is waiting on you.</p>
        </div>
      ) : (
        <>
          {model.approvals.length > 0 && <ApprovalInbox approvals={model.approvals} />}
          {model.waiting.length > 0 && (
            <ul className="mt-3 space-y-2">
              {model.waiting.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/30 bg-gold-soft px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-muted">{item.summary}</p>
                  </div>
                  <Link href={item.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-dark">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="block-blue p-5 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-white">{model.planLabel} plan · credits left</p>
            {model.plan === "free" ? (
              <UpgradeLink href="/pricing" plan={model.plan} source="dashboard" className="inline-flex min-h-11 items-center rounded-full bg-ink px-3 text-xs font-bold text-white">Upgrade</UpgradeLink>
            ) : (
              <span className="font-mono text-[13px] text-white">${model.price}/mo{model.cardLast4 ? ` · card •••• ${model.cardLast4}` : ""}</span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight">{formatCredits(model.creditsRemaining)}</span>
            <span className="text-white">credits · {model.creditsAllowance.toLocaleString()}/month</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/30">
            <div className={`h-full rounded-full ${empty || model.lowBalance ? "bg-yellow" : "bg-green"}`} style={{ width: `${Math.max(4, 100 - runsPct)}%` }} />
          </div>
          <p className="mt-2 font-mono text-[13px] text-white">
            {model.topup > 0 ? `${formatCredits(model.topup)} top-up credits do not expire · ` : ""}
            {model.nextBilling ? `Monthly credits reset ${model.nextBilling}` : "Monthly credits reset each cycle"}
            {model.plan !== "free" && ` · ≈ ₦${Math.round(model.price * NGN_RATE).toLocaleString()}/mo`}
          </p>
          <form action="/api/checkout" method="POST" className="mt-3">
            <input type="hidden" name="plan" value="topup" />
            <button className="inline-flex min-h-11 items-center rounded-full bg-ink px-3 text-xs font-bold text-white">
              Buy {CREDIT_TOPUP.credits} credits · ${CREDIT_TOPUP.price}
            </button>
          </form>
        </div>
        <div className="block-green p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide">Connected apps</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{model.connected.length}</p>
          <ConnectedApps apps={model.connected} />
          <Link href="/apps" className="mt-2 inline-flex min-h-11 max-w-full items-center text-sm font-semibold underline">Browse apps</Link>
        </div>
      </div>

      <h2 className="mt-12 text-2xl font-bold tracking-tight">
        Autonomous agents <span className="font-mono text-sm font-normal text-muted">({model.threads.length})</span>
      </h2>
      {model.threads.length === 0 ? (
        <div className="surface mt-4 px-6 py-10 text-center">
          <EmptyArt kind="chats" />
          <p className="text-lg font-semibold">No chats yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Start a chat and the agent shows up here. Ask it to repeat the work if you want a schedule.</p>
          <Link href="/agentic-chat" className="btn-ink mt-5 text-sm">Open chat</Link>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {model.threads.map((thread) => (
            <li key={thread.id}>
              <Link href={`/agentic-chat?thread=${encodeURIComponent(thread.id)}`} className="surface lift block p-4">
                <p className="font-semibold">{thread.title || "New agent"}</p>
                <p className="mt-2 font-mono text-[11px] text-muted">{when(thread.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-12 text-2xl font-bold tracking-tight">
        Scheduled agents <span className="font-mono text-sm font-normal text-muted">({model.schedules.length})</span>
      </h2>
      {model.schedules.length === 0 ? (
        <div className="surface mt-4 px-5 py-8 text-center">
          <EmptyArt kind="schedules" />
          <p className="text-sm text-muted">No schedules yet. Save one from a chat, or ask the agent to run something again.</p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {model.schedules.map((schedule) => (
            <li key={schedule.id} className="surface p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{schedule.name}</p>
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{schedule.status}</span>
              </div>
              <p className="mt-2 text-sm">{schedule.cadenceLabel}</p>
              <p className="mt-1 font-mono text-[11px] text-muted">Next {schedule.status === "paused" ? "paused" : when(schedule.nextRunAt, schedule.timezone)}</p>
              <Link href="/schedule" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent-dark">Open schedule</Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-12 text-2xl font-bold tracking-tight">Recent credit use</h2>
      {model.usage.length === 0 ? (
        <p className="surface mt-4 px-5 py-6 text-center text-sm text-muted">No metered usage yet.</p>
      ) : (
        <ul className="surface mt-4 divide-y divide-line">
          {model.usage.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
              <span className="font-medium">{usageLabel(item.type)}</span>
              <span className="font-mono text-xs text-muted">{formatCredits(item.credits)} credits · {when(item.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-12 text-2xl font-bold tracking-tight">Recent runs</h2>
      {model.runs.length === 0 ? (
        <p className="surface mt-4 px-5 py-8 text-center text-sm text-muted">No runs yet. A scheduled run or a chat will show up here.</p>
      ) : (
        <div className="surface mt-4 overflow-hidden">
          {model.runs.map((run) => (
            <Link key={run.id} href={run.href} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm last:border-0 hover:bg-ground/60 sm:px-5">
              <span className="min-w-0">
                <span className="block truncate font-medium">{run.name}</span>
                <span className="block truncate font-mono text-xs text-muted">{run.summary}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block font-mono text-xs font-semibold ${run.status === "success" ? "text-mint" : run.status === "error" ? "text-accent-dark" : "text-gold"}`}>{run.status}</span>
                <span className="block font-mono text-[11px] text-muted">{when(run.at)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {model.hired.length > 0 && (
        <>
          <h2 className="mt-12 text-2xl font-bold tracking-tight">Earlier agents</h2>
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {model.hired.map((agent) => (
              <li key={agent.id}>
                <Link href={`/dashboard/agents/${agent.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-ground/60 sm:px-5">
                  <span className="font-medium">{agent.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {agent.status} · {agent.schedule}
                    {agent.lastRun ? ` · last ${when(agent.lastRun)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {model.payments.length > 0 && (
        <>
          <h2 className="mt-12 text-2xl font-bold tracking-tight">Recent payments</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
            {model.payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between border-b border-line px-5 py-3 text-sm last:border-0">
                <div>
                  <p className="font-medium">{payment.description}</p>
                  <p className="font-mono text-xs text-muted">{payment.when} · {payment.reference}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{payment.amount}</p>
                  <p className={`font-mono text-xs ${payment.status === "success" ? "text-mint" : payment.status === "failed" ? "text-accent-dark" : "text-muted"}`}>{payment.status}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function usageLabel(type: string): string {
  if (type === "web_search") return "Web search";
  if (type === "desktop") return "Cloud desktop";
  return "Model";
}

function when(iso: string | null, timeZone?: string): string {
  if (!iso) return "not scheduled";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "not scheduled";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

function previewModel(empty = false): DashModel {
  const cadence = describeCadence({ kind: "weekdays", time: "09:00", weekday: null, hours: null, cron: "0 9 * * 1-5", timezone: "America/New_York" });
  return {
    firstName: "Ada",
    plan: "free",
    planLabel: "Free",
    price: 0,
    creditsRemaining: empty ? 0 : 38,
    creditsAllowance: 50,
    topup: 0,
    lowBalance: false,
    usage: [
      { id: "use-1", type: "model", credits: 1.2, at: "2026-11-13T14:00:00.000Z" },
      { id: "use-2", type: "web_search", credits: 1, at: "2026-11-13T13:40:00.000Z" },
    ],
    cardLast4: null,
    nextBilling: null,
    connected: [{ toolkit: "gmail", logo: null }],
    threads: [
      { id: "preview-thread", title: "Friday recap", updatedAt: "2026-11-13T14:05:00.000Z" },
      { id: "preview-thread-2", title: "Inbox sweep", updatedAt: "2026-11-13T12:10:00.000Z" },
    ],
    schedules: [
      { id: "preview-1", name: "Friday recap", cadenceLabel: cadence, nextRunAt: "2026-11-16T14:00:00.000Z", status: "active", timezone: "America/New_York" },
    ],
    runs: [
      { id: "run-1", name: "Friday recap", status: "success", summary: "Drafted the recap and left it in the chat.", at: "2026-11-13T14:00:00.000Z", href: "/agentic-chat?thread=preview-thread" },
      { id: "run-2", name: "Inbox sweep", status: "waiting", summary: "Waiting for approval before anything is sent.", at: "2026-11-13T13:00:00.000Z", href: "/agentic-chat?thread=preview-thread-2" },
    ],
    approvals: [],
    waiting: [{ id: "run-2", name: "Inbox sweep", summary: "Waiting for approval before anything is sent.", href: "/agentic-chat?thread=preview-thread-2" }],
    hired: [],
    payments: [],
    hiredBanner: false,
    toppedUp: false,
    upgraded: null,
  };
}
