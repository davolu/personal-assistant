import Link from "next/link";
import { SITE, PLANS } from "@/lib/site";

const STEPS = [
  {
    n: "01",
    t: "Describe the outcome",
    d: "Say what you want done in plain language. AgentDock creates an autonomous agent from that conversation.",
  },
  {
    n: "02",
    t: "Connect your apps",
    d: "One-click sign-in for the tools the agent needs. No API keys and no developer setup.",
  },
  {
    n: "03",
    t: "Let it work",
    d: "It chooses the next step, tries another way when one fails, and asks before it sends, deletes, or pays.",
  },
];

export default function Home() {
  return (
    <>
      <section className="dotgrid flex min-h-[calc(100dvh-8.5rem)] flex-col justify-center md:min-h-[calc(100dvh-4rem)]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-5 sm:py-20 lg:py-24">
          <h1 className="mx-auto max-w-4xl text-balance text-[2.35rem] font-bold leading-[1.05] tracking-tight min-[420px]:text-5xl lg:text-6xl">
            {SITE.hero.titleLead} <span className="text-accent">{SITE.hero.titleRest}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted sm:mt-6 sm:text-lg">
            {SITE.hero.subtitle}
          </p>
          <ul className="mx-auto mt-8 grid w-full max-w-5xl grid-cols-1 gap-2 min-[380px]:grid-cols-2 lg:grid-cols-4">
            {SITE.hero.promises.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 rounded-xl border border-accent/15 bg-accent-soft px-3 py-2.5 text-left text-sm font-semibold leading-snug text-ink"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
            <Link
              href={SITE.hero.ctaHref}
              className="rounded-xl bg-accent px-7 py-3.5 text-center font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {SITE.hero.ctaLabel}
            </Link>
            <a
              href={SITE.hero.secondaryHref}
              className="rounded-xl border border-line bg-panel px-7 py-3.5 text-center font-semibold shadow-sm transition hover:border-ink/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {SITE.hero.secondaryLabel}
            </a>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-line bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">How it works</p>
          <h2 className="mt-2 max-w-xl text-balance text-3xl font-bold tracking-tight">Three steps, then it keeps going</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="rounded-xl border border-line bg-ground p-6">
                <span className="font-mono text-sm font-bold text-accent">{step.n}</span>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{step.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-ink text-ground">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
          <div className="flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-center">
            <div className="max-w-md">
              <p className="font-mono text-xs uppercase tracking-widest text-accent">Pricing</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                Unlimited agents.
                <br />
                Pay only for runs.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ground/70">
                Add as many autonomous agents as you want on every plan. Your plan is how many runs
                they share each month. Agents pause at the cap.
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
