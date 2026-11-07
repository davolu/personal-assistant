import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBot } from "@/lib/agents";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { toolkitLogo } from "@/lib/toolkits";
import TrainAgentButton from "@/components/TrainAgentButton";

export const metadata: Metadata = { title: "Connect your accounts" };

export default function ConnectPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hired?: string; connected?: string; failed?: string }>;
}) {
  return (
    <Suspense fallback={<div className="min-h-[70vh]" />}>
      <ConnectContent {...props} />
    </Suspense>
  );
}

async function ConnectContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hired?: string; connected?: string; failed?: string }>;
}) {
  const { slug } = await params;
  const { hired: justHired, connected, failed } = await searchParams;

  const session = await getSession();
  if (!session) redirect(`/signin?next=${encodeURIComponent(`/connect/${slug}`)}`);

  // Resolve toolkits: a catalog template, or a custom agent ("custom:<id>" slug form)
  let agentName: string;
  let toolkits: string[];
  if (slug.startsWith("custom-")) {
    const custom = await prisma.customAgent.findFirst({
      where: { id: slug.replace(/^custom-/, ""), userId: session.user.id },
    });
    if (!custom) notFound();
    agentName = custom.name;
    toolkits = custom.toolkits;
  } else {
    const bot = getBot(slug);
    if (!bot) notFound();
    agentName = bot.name;
    toolkits = bot.toolkits;
  }

  const connections = await prisma.connection.findMany({
    where: { userId: session.user.id, toolkit: { in: toolkits } },
  });
  const statusOf = (t: string) => connections.find((c) => c.toolkit === t)?.status ?? "none";
  const allConnected = toolkits.every((t) => statusOf(t) === "active");
  const hired = await prisma.hiredAgent.findUnique({
    where: { userId_slug: { userId: session.user.id, slug } },
  });

  return (
    <div className="dotgrid min-h-[70vh] px-5 py-16">
      <div className="mx-auto max-w-lg">
        <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">
          {justHired ? "Agent hired 🎉" : "Connections"}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Connect your accounts for {agentName}
        </h1>
        <p className="mt-3 text-muted">
          One-click sign-in for each tool — no API keys. Connections are reused by every agent you
          add later.
        </p>

        {connected && (
          <p className="mt-4 rounded-lg bg-mint-soft px-4 py-3 text-sm font-medium text-mint">
            ✓ {connected} connected.
          </p>
        )}
        {failed && (
          <p className="mt-4 rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent-dark">
            {failed} connection didn&apos;t complete — try again.
          </p>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
          {toolkits.map((t) => {
            const st = statusOf(t);
            const logo = toolkitLogo(t, 64);
            return (
              <div key={t} className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-0">
                <div className="flex items-center gap-3">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="size-6 rounded-md" />
                  ) : (
                    <span className="grid size-6 place-items-center rounded-md bg-line text-xs font-bold">{t[0]}</span>
                  )}
                  <div>
                    <p className="font-semibold">{t}</p>
                    <p className="font-mono text-[11px] text-muted">
                      {st === "active" ? "Connected" : st === "pending" ? "Waiting for sign-in…" : "Not connected"}
                    </p>
                  </div>
                </div>
                {st === "active" ? (
                  <span className="rounded-full bg-mint-soft px-3 py-1 font-mono text-xs font-semibold text-mint">✓ Connected</span>
                ) : (
                  <form action="/api/connections/initiate" method="POST">
                    <input type="hidden" name="toolkit" value={t} />
                    <input type="hidden" name="agent" value={slug} />
                    <button className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-ground transition hover:bg-ink/85">
                      Connect
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {allConnected && hired && (
          <div className="mt-6">
            <p className="mb-2 font-mono text-xs uppercase tracking-widest text-accent-dark">
              Final step — train until it succeeds
            </p>
            {hired.status === "draft" && (
              <p className="mb-3 text-sm text-muted">
                This agent is a <strong>draft</strong>. It goes live — and becomes schedulable —
                only once a training run succeeds, so everything that runs later is proven.
              </p>
            )}
            <TrainAgentButton agentId={hired.id} />
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm font-semibold text-muted hover:text-ink">
            {allConnected ? "" : "I'll finish this later →"}
          </Link>
          <Link
            href="/dashboard"
            className={`rounded-xl px-6 py-3 font-semibold transition ${
              allConnected
                ? "bg-ink text-ground hover:bg-ink/85"
                : "border border-line text-muted hover:border-ink/30 hover:text-ink"
            }`}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
