import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bots, getBot, related } from "@/lib/agents";
import BotCard from "@/components/BotCard";
import TierBadge from "@/components/TierBadge";
import ToolkitChip from "@/components/ToolkitChip";
import { TIERS } from "@/lib/site";

export function generateStaticParams() {
  return bots.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) return {};
  return { title: bot.name, description: `${bot.desc}. Saves ~${bot.timeSavedHrs} hours/month.` };
}

export default async function BotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bot = getBot(slug);
  if (!bot) notFound();

  const tier = TIERS[bot.tier];
  const rel = related(bot);

  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      {/* Breadcrumb */}
      <nav className="font-mono text-xs text-muted">
        <Link href="/agents" className="hover:text-ink">Agents</Link>
        <span className="mx-2">/</span>
        <Link href={`/agents?group=${encodeURIComponent(bot.group)}`} className="hover:text-ink">
          {bot.group}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{bot.name}</span>
      </nav>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div>
          <TierBadge tier={bot.tier} />
          <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight">{bot.name}</h1>
          <p className="mt-3 text-pretty text-lg leading-relaxed text-muted">{bot.desc}.</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {bot.toolkits.map((t) => (
              <ToolkitChip key={t} name={t} size="lg" />
            ))}
          </div>

          {/* Savings band */}
          <div className="mt-8 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-panel text-center">
            <div className="p-5">
              <p className="text-2xl font-bold tracking-tight">~{bot.timeSavedHrs} hrs</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">saved / month</p>
            </div>
            <div className="p-5">
              <p className="text-2xl font-bold tracking-tight text-mint">
                ~${bot.moneySavedUsd.toLocaleString()}
              </p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">value / month*</p>
            </div>
            <div className="p-5">
              <p className="text-2xl font-bold tracking-tight text-accent-dark">{bot.toolkits.length} tool{bot.toolkits.length > 1 ? "s" : ""}</p>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted">one-click connect</p>
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">
            *Estimate: {bot.timeSavedHrs} hours at typical {bot.group.toLowerCase()} rates. Your numbers will vary.
          </p>

          {/* What it does in practice */}
          <section className="mt-12">
            <h2 className="text-2xl font-bold tracking-tight">What it does in practice</h2>
            <ol className="mt-6 space-y-4">
              {bot.steps.map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs font-bold text-accent-dark">
                    {i + 1}
                  </span>
                  <p className="leading-relaxed text-ink/90">{s}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Why it's useful */}
          <section className="mt-12 rounded-xl border border-line bg-panel p-7">
            <h2 className="text-2xl font-bold tracking-tight">Why it&apos;s useful</h2>
            <p className="mt-4 leading-relaxed text-ink/90">{bot.why}</p>
            <p className="mt-4 leading-relaxed text-muted">
              Like every template, it&apos;s included in your plan — runs are the only thing that
              counts. At ~{bot.timeSavedHrs} hours back every month, it earns its keep before
              you&apos;ve finished your first coffee of the month.
            </p>
          </section>

          {/* Who it's for */}
          <section className="mt-12">
            <h2 className="text-2xl font-bold tracking-tight">Who it&apos;s for</h2>
            <p className="mt-4 leading-relaxed text-ink/90">
              Built for <strong>{bot.category.toLowerCase()}</strong>. {capitalize(bot.whoPays)}
            </p>
          </section>
        </div>

        {/* Sidebar */}
        <aside className="h-fit lg:sticky lg:top-24">
          <div className="rounded-2xl border border-line bg-panel p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-bold tracking-tight">Included</span>
              <span className="font-mono text-xs text-muted">in every plan</span>
            </div>
            <p className="mt-1 text-sm text-muted">{tier.blurb}</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              <SidebarItem>✓ Unlimited agents on every plan</SidebarItem>
              <SidebarItem>✓ Runs count against your monthly quota</SidebarItem>
              <SidebarItem>✓ {bot.toolkits.length} integration{bot.toolkits.length > 1 ? "s" : ""}, one-click connect</SidebarItem>
              <SidebarItem>✓ Scheduled or event-triggered</SidebarItem>
              <SidebarItem>✓ Pauses at your run cap — no surprise bills</SidebarItem>
            </ul>
            <Link
              href={`/hire/${bot.slug}`}
              className="mt-6 block w-full rounded-xl bg-accent py-3.5 text-center font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark"
            >
              Add this agent — it&apos;s included
            </Link>
            <Link
              href="/pricing"
              className="mt-2 block w-full rounded-xl border border-line py-3 text-center text-sm font-semibold text-muted transition hover:border-ink/30 hover:text-ink"
            >
              How run pricing works
            </Link>
            <p className="mt-4 text-center font-mono text-[11px] text-muted">
              Free plan: 50 runs/mo · Starter $15: 1,000 runs
            </p>
          </div>
        </aside>
      </div>

      {/* Related */}
      {rel.length > 0 && (
        <section className="mt-20">
          <h2 className="text-2xl font-bold tracking-tight">
            More agents for {bot.category.toLowerCase()}
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {rel.map((b) => (
              <BotCard key={b.slug} bot={b} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SidebarItem({ children }: { children: React.ReactNode }) {
  return <li className="leading-snug text-ink/85">{children}</li>;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
