export const SITE = {
  name: "Personal Assistant",
  domain: "agentdock.io",
  tagline: "One chat that works across your apps",
  description:
    "A chat assistant that plans, uses your connected apps through MCP and Composio, and waits for you before it sends, deletes, or pays.",
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

// Run-based subscription plans — unlimited agents on every plan.
export const PLANS = {
  free: { label: "Free", price: 0, runs: 50, blurb: "Try it out — unlimited agents, 50 runs a month." },
  starter: { label: "Starter", price: 15, runs: 1000, blurb: "For individuals automating their daily work." },
  pro: { label: "Pro", price: 39, runs: 5000, blurb: "For power users and small teams." },
  scale: { label: "Scale", price: 99, runs: 20000, blurb: "For agencies running agents across clients." },
} as const;

export type PlanKey = keyof typeof PLANS;

export const RUN_TOPUP = { price: 3, runs: 1000 };
