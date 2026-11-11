import Link from "next/link";
import { bots, categories, GROUPS } from "@/lib/agents";
import BotCard from "@/components/BotCard";
import { SITE, PLANS } from "@/lib/site";
import { toolkitLogo } from "@/lib/toolkits";

const FEATURED_SLUGS = [
  "inbox-chief-of-staff",
  "first-response-drafter",
  "ar-collections-agent",
  "client-status-reporter",
  "quote-follow-up-engine",
  "no-show-shield",
];

const TOOLKIT_STRIP = [
  "Gmail", "Slack", "Notion", "HubSpot", "Stripe", "Google Calendar", "WhatsApp",
  "QuickBooks", "Linear", "Square", "Calendly", "GitHub", "Salesforce",
  "Zendesk", "Mailchimp", "Google Sheets", "Trello", "LinkedIn", "YouTube", "Figma",
];

export default function Home() {
  const featured = FEATURED_SLUGS.map((s) => bots.find((b) => b.slug === s)).filter(
    (b): b is NonNullable<typeof b> => Boolean(b)
  );

  return (
    <>
      {/* Hero */}
      <section className="dotgrid border-b border-line">
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-24 text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-panel px-4 py-1.5 font-mono text-xs text-muted shadow-sm">
            <span className="size-1.5 rounded-full bg-mint" /> Chat · MCP · Composio · approval before send, delete, or pay
          </p>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Your <span className="text-accent">personal assistant</span>, across your apps
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted">
            {SITE.description}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/chat"
              className="rounded-xl bg-accent px-7 py-3.5 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark"
            >
              Open the chat
            </Link>
            <Link
              href="/agents"
              className="rounded-xl border border-line bg-panel px-7 py-3.5 font-semibold shadow-sm transition hover:border-ink/30"
            >
              Browse templates
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-muted">Claude plans the work. Code decides what is allowed to run.</p>
        </div>
      </section>

      {/* Toolkit strip */}
      <section className="border-b border-line bg-panel py-5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2.5 px-5 font-mono text-xs text-muted">
          <span className="font-semibold uppercase tracking-widest">Works with</span>
          {TOOLKIT_STRIP.slice(0, 14).map((t) => {
            const logo = toolkitLogo(t, 32);
            return (
              <span key={t} className="inline-flex items-center gap-1.5">
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-3.5 rounded-[2px]" loading="lazy" />
                )}
                {t}
              </span>
            );
          })}
          <span className="text-accent-dark">+113 more</span>
        </div>
      </section>

      {/* Featured bots */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Most hired</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Start with a proven agent</h2>
          </div>
          <Link href="/agents" className="hidden text-sm font-semibold text-accent-dark hover:underline sm:block">
            View all 1,000 →
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((b) => (
            <BotCard key={b.slug} bot={b} />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">How it works</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight">Three steps, no engineering</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Pick a template — or describe your own",
                d: "Choose from over 1,000 ready templates — or type what you want automated and AI drafts the agent for you.",
              },
              {
                n: "02",
                t: "Connect your tools",
                d: "One-click OAuth for Gmail, Slack, Notion, Stripe and 123 other apps. No API keys, no developer setup — auth is fully managed.",
              },
              {
                n: "03",
                t: "Set a schedule",
                d: "Run it daily, hourly, or the instant something happens (a new email, ticket, or payment). Then watch the work disappear.",
              },
            ].map((s) => (
              <div key={s.n} className="rounded-xl border border-line bg-ground p-6">
                <span className="font-mono text-sm font-bold text-accent">{s.n}</span>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">For every kind of work</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight">50 niches, 20 templates each</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((g) => {
            const cats = categories.filter((c) => c.group === g);
            const count = cats.reduce((a, c) => a + c.count, 0);
            return (
              <Link
                key={g}
                href={`/agents?group=${encodeURIComponent(g)}`}
                className="group rounded-xl border border-line bg-panel p-6 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold tracking-tight group-hover:text-accent-dark">{g}</h3>
                  <span className="font-mono text-xs text-muted">{count} templates</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted">
                  {cats.slice(0, 4).map((c) => c.category).join(" · ")}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Create your own */}
      <section className="border-t border-line bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Agent builder</p>
          <h2 className="mx-auto mt-2 max-w-xl text-balance text-3xl font-bold tracking-tight">
            Can&apos;t find it? Describe it — AI builds it.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted">
            No drag-and-drop, no code. Type what you want automated in plain language, review the
            AI-drafted workflow plan, accept it — and it&apos;s a live agent. Keep it private or
            publish it as a community template.
          </p>
          <Link
            href="/create"
            className="mt-6 inline-block rounded-xl bg-ink px-7 py-3.5 font-semibold text-ground transition hover:bg-ink/85"
          >
            ✨ Create your own agent
          </Link>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-line bg-ink text-ground">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-center">
            <div className="max-w-md">
              <p className="font-mono text-xs uppercase tracking-widest text-accent">Pricing</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Unlimited agents.
                <br />
                Pay only for runs.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ground/70">
                Add as many agents as you want on every plan — templates and custom builds alike.
                Your plan is just how many runs they share each month. Agents pause at the cap; no
                surprise bills, ever.
              </p>
              <Link
                href="/pricing"
                className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-white transition hover:bg-accent-dark"
              >
                See full pricing
              </Link>
            </div>
            <div className="grid w-full max-w-md gap-3">
              {(Object.entries(PLANS) as [string, (typeof PLANS)[keyof typeof PLANS]][]).map(([k, p]) => (
                <div key={k} className="flex items-center justify-between rounded-xl border border-ground/15 bg-ground/5 px-5 py-4">
                  <div>
                    <span className="font-semibold">{p.label}</span>
                    <p className="mt-0.5 text-xs text-ground/60">{p.blurb}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-bold">${p.price}</span>
                    <span className="text-xs text-ground/60">/mo</span>
                    <p className="font-mono text-[10px] text-ground/50">{p.runs.toLocaleString()} runs</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
