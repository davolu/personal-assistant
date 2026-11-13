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

// Run-based subscription plans — unlimited agents on every plan.
export const PLANS = {
  free: { label: "Free", price: 0, runs: 50, blurb: "Try it out — unlimited agents, 50 runs a month." },
  starter: { label: "Starter", price: 15, runs: 1000, blurb: "For individuals automating their daily work." },
  pro: { label: "Pro", price: 39, runs: 5000, blurb: "For power users and small teams." },
  scale: { label: "Scale", price: 99, runs: 20000, blurb: "For agencies running agents across clients." },
} as const;

export type PlanKey = keyof typeof PLANS;

export const RUN_TOPUP = { price: 3, runs: 1000 };
