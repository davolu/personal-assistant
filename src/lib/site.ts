/** Public catalog wording. Do not recompute or repeat the number elsewhere. */
export const APP_CATALOG = {
  label: "Over 1,500 apps supported",
  credit: "Powered by Composio",
} as const;

export const SITE = {
  name: "AgentDocker",
  domain: "agentdocker.io",
  tagline: "Create autonomous agents by chatting",
  description:
    "No code. Describe the outcome in chat. AgentDocker creates an agent that chooses its tools, connects your apps, works on its own cloud desktop, and asks before anything risky.",
  hero: {
    eyebrow: "Autonomous agents",
    titleLead: "Create autonomous agents",
    titleRest: "by chatting",
    subtitle:
      "No code. Describe the outcome in chat, and AgentDocker creates an agent that does the work and tries another way when a step fails.",
    promises: [
      "Chooses which tools to use",
      "Connects your apps",
      "Uses its own cloud desktop",
      "Asks before anything risky",
    ],
    ctaHref: "/agentic-chat",
    ctaLabel: "Start chatting",
    secondaryHref: "#how-it-works",
    secondaryLabel: "See how it works",
  },
  signInTitle: "Welcome back to AgentDocker",
  signInSubtitle: "Sign in to the agents you create by chatting.",
};

// Complexity badges on templates (informational — every template is included in every plan)
export const TIERS = {
  lite: {
    label: "Lite",
    emoji: "⚡",
    blurb: "One narrow job, done relentlessly. Alerts, chasers, reminders, logs.",
  },
  standard: {
    label: "Standard",
    emoji: "🔧",
    blurb: "Multi-step workflows across 2–3 tools. Drafts wait for your approval.",
  },
  pro: {
    label: "Pro",
    emoji: "🚀",
    blurb: "Synthesis, judgment, and polished client-facing deliverables.",
  },
} as const;

export type TierKey = keyof typeof TIERS;

/**
 * Credit plans. 1 credit = $0.01 of metered provider cost, so the allowance is the
 * provider spend included in the price. Margins against that cost, before payment fees:
 * Starter $15 / $11 (26.7%), Pro $39 / $30 (23.1%), Scale $99 / $80 (19.2%).
 * Monthly credits reset each billing cycle and unused plan credits expire.
 * Top-up credits never expire and are spent only after the monthly balance is gone.
 * maxTier is the most expensive model tier the plan may select.
 * extraModels are registry ids allowed above that tier. desktop is the cloud computer.
 */
const NO_EXTRA_MODELS = [] as const;

export const PLANS = {
  free: {
    label: "Free",
    price: 0,
    credits: 50,
    maxTier: "cheap",
    extraModels: ["claude-sonnet-5-5"] as const,
    desktop: false,
    blurb: "Try it out — cheap models, 50 credits a month.",
  },
  starter: {
    label: "Starter",
    price: 15,
    credits: 1100,
    maxTier: "premium",
    extraModels: NO_EXTRA_MODELS,
    desktop: true,
    blurb: "For individuals automating their daily work.",
  },
  pro: {
    label: "Pro",
    price: 39,
    credits: 3000,
    maxTier: "premium",
    extraModels: NO_EXTRA_MODELS,
    desktop: true,
    blurb: "For power users and small teams.",
  },
  scale: {
    label: "Scale",
    price: 99,
    credits: 8000,
    maxTier: "premium",
    extraModels: NO_EXTRA_MODELS,
    desktop: true,
    blurb: "For agencies running agents across clients.",
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function isPlanKey(value: string): value is PlanKey {
  return value in PLANS;
}

/** Non-expiring credit pack. 400 credits cost $4 to serve, a 20% margin on $5. */
export const CREDIT_TOPUP = { price: 5, credits: 400, expires: false } as const;
