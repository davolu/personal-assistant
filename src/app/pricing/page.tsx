import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { PlanCheckoutButton } from "@/components/UpgradeLink";
import { APP_CATALOG, CREDIT_TOPUP, PLANS, type PlanKey } from "@/lib/site";
import { typicalRuns } from "@/lib/credits";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Unlimited agents on every plan. Pay for credits — from a free monthly allowance to 8,000 credits.",
};

const FAQ = [
  {
    q: "What is a credit?",
    a: "A credit is a small slice of work. Model calls, web searches, and cloud desktop time spend credits as they run. A short task on a cheap model uses a handful. Heavier models and the desktop use more. You only spend credits while an agent is actually working.",
  },
  {
    q: "How many agents can I add?",
    a: "As many as you like, on every plan — including Free. Agents themselves cost nothing. Your plan is the pool of credits they share each month.",
  },
  {
    q: "What happens when I run out of credits?",
    a: `The agent stops and tells you, and the chat stays where it was. Upgrade, or buy ${CREDIT_TOPUP.credits.toLocaleString()} extra credits for $${CREDIT_TOPUP.price}. Those top-up credits do not expire. Monthly plan credits reset each cycle, and unused plan credits do not roll over. You will never get a surprise bill.`,
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
            Unlimited agents. Pay for credits.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            Add as many agents as you want. Your plan is the monthly credit pool they share.
            About {typicalRuns(PLANS.free.credits)} typical runs on a cheap model fit in Free.
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
                  <li className="font-semibold">✓ {p.credits.toLocaleString()} credits / month</li>
                  <li>✓ About {typicalRuns(p.credits).toLocaleString()} typical runs on a cheap model</li>
                  <li>✓ Unlimited agents</li>
                  <li>✓ {APP_CATALOG.label}. {APP_CATALOG.credit}</li>
                  {key === "free" ? <li>✓ Cheap models</li> : <li>✓ Every model in the picker</li>}
                  {p.desktop ? <li>✓ Cloud desktop</li> : <li>✓ Chat and connected apps</li>}
                  <li>✓ Top-ups: ${CREDIT_TOPUP.price} for {CREDIT_TOPUP.credits.toLocaleString()} credits</li>
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
                    <PlanCheckoutButton plan={key} className={`w-full ${popular ? "btn-ink btn-sun" : "btn-ink"}`}>
                      Get {p.label}
                    </PlanCheckoutButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        <form action="/api/checkout" method="POST" className="mx-auto mt-8 flex max-w-xl flex-col items-center gap-3 rounded-[1.75rem] border border-line bg-panel px-5 py-6 text-center sm:flex-row sm:text-left">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Need more this month?</p>
            <p className="mt-1 text-sm text-muted">
              ${CREDIT_TOPUP.price} adds {CREDIT_TOPUP.credits.toLocaleString()} credits. They do not expire, and they are used after your monthly credits.
            </p>
          </div>
          <input type="hidden" name="plan" value="topup" />
          <button className="btn-ink shrink-0">Buy credits</button>
        </form>

        <p className="mt-6 text-center font-mono text-xs text-muted">
          Billed monthly via Paystack · the agent stops at zero credits — no surprise bills · cancel anytime
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
