import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { APP_CATALOG, PLANS, RUN_TOPUP, type PlanKey } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Unlimited agents on every plan. Pay only for runs — from free to 20,000 runs a month.",
};

const FAQ = [
  {
    q: "What exactly is a “run”?",
    a: "One complete execution of an agent: it wakes up (on schedule or when a trigger fires), does its whole job — even if that's several steps across several tools — and goes back to sleep. A daily agent uses ~30 runs a month; an email-triggered agent uses one run per email handled.",
  },
  {
    q: "How many agents can I add?",
    a: "As many as you like, on every plan — including Free. Agents themselves cost nothing; your plan is only about how many runs they share each month.",
  },
  {
    q: "What happens when I hit my run limit?",
    a: "Your agents pause and we email you. Upgrade, or top up with 1,000 extra runs for $3 whenever you like. You will never get a surprise bill.",
  },
  {
    q: "Do I need API keys or a developer?",
    a: `No. ${APP_CATALOG.label}. ${APP_CATALOG.credit}. Connecting is one-click OAuth — the same "Sign in with Google" flow you already know. Auth and token refresh are fully managed.`,
  },
  {
    q: "Can I cancel?",
    a: "Any time — you drop back to the Free plan and keep all your agents and connections.",
  },
];

export default function PricingPage() {
  return (
    <Suspense>
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">Pricing</p>
          <h1 className="mt-2 text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Unlimited agents. Pay for runs.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Add as many agents as you want — over 1,000 ready templates plus your own AI-built
            custom agents. Your plan is just the number of runs they share each month.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(([key, p]) => {
            const popular = key === "starter";
            return (
              <div
                key={key}
                className={`relative rounded-[1.75rem] bg-panel p-7 ${
                  popular ? "border-2 border-ink shadow-[var(--shadow-card)]" : "border border-line"
                }`}
              >
                {popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-yellow px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ink">
                    Most popular
                  </span>
                )}
                <h2 className="font-semibold">{p.label}</h2>
                <p className="mt-2 text-4xl font-bold tracking-tight">
                  ${p.price}
                  {p.price > 0 && <span className="text-base font-normal text-muted">/mo</span>}
                </p>
                <p className="mt-1 text-sm text-muted">{p.blurb}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-ink/85">
                  <li className="font-semibold">✓ {p.runs.toLocaleString()} runs / month</li>
                  <li>✓ Unlimited agents</li>
                  <li>✓ All 1,000+ templates</li>
                  <li>✓ AI custom agent builder</li>
                  <li>✓ {APP_CATALOG.label}. {APP_CATALOG.credit}</li>
                  {key !== "free" && <li>✓ Event triggers (real-time)</li>}
                  {key !== "free" && <li>✓ Run top-ups: ${RUN_TOPUP.price} per {RUN_TOPUP.runs.toLocaleString()}</li>}
                </ul>
                {key === "free" ? (
                  <Link
                    href="/agentic-chat"
                    className="btn-ghost mt-7 w-full"
                  >
                    Start free
                  </Link>
                ) : (
                  <form action="/api/checkout" method="POST" className="mt-7">
                    <input type="hidden" name="plan" value={key} />
                    <button
                      className={`w-full ${popular ? "btn-ink btn-sun" : "btn-ink"}`}
                    >
                      Get {p.label}
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center font-mono text-xs text-muted">
          Billed monthly via Paystack · agents pause at your run cap — no surprise bills · cancel anytime
        </p>

        {/* FAQ */}
        <div className="mx-auto mt-20 max-w-2xl">
          <h2 className="text-center text-2xl font-bold tracking-tight">Questions, answered</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-xl border border-line bg-panel p-5 open:shadow-sm">
                <summary className="cursor-pointer list-none font-semibold marker:hidden">
                  <span className="mr-2 inline-block font-mono text-accent-dark transition group-open:rotate-45">+</span>
                  {f.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </Suspense>
  );
}
