import type { Plan, Proposal } from "./types";
import { parsePlan } from "./planner";

/** One catalog action. Names come from the host that listed them, never from a fixed table. */
export type CatalogAction = {
  slug: string;
  description?: string;
  toolkit?: string;
  toolkitName?: string;
  required?: string[];
  /** From Composio's toolkit connection status. Absent when this action did not come from a search. */
  connected?: boolean;
};

export type QuestionCard = {
  id: string;
  prompt: string;
  choices: string[];
  required: boolean;
  allowSkip: boolean;
};

export type MappedStep = {
  goal: string;
  tool: string;
  toolkit: string;
  app: string;
  connected: boolean;
};

export type PlanningState = {
  brief: string;
  answers: Record<string, string>;
  status: "asking" | "ready" | "unsupported";
  question?: QuestionCard | null;
  proposal?: Proposal | null;
  notes?: string;
  /** Catalog actions found on earlier turns of this conversation. */
  candidates?: CatalogAction[];
};

export type CatalogDecision =
  | { kind: "direct"; plan: Plan; reasoning: string }
  | { kind: "search"; toolkits: string[]; capabilities: string[]; queries: string[]; reasoning: string }
  | { kind: "ask"; question: QuestionCard; reasoning: string; choicesOmitted: boolean }
  | { kind: "propose"; understanding: string; steps: { goal?: string; tool: string }[]; reasoning: string }
  | { kind: "invalid"; reasoning: string };

export function isWebSearchTool(name: string): boolean {
  return name === "builtin.web.search" || name.startsWith("COMPOSIO_SEARCH");
}

export function toolkitOf(slug: string): string {
  return slug.split("_")[0]?.toLowerCase() ?? "";
}

export function displayName(action: CatalogAction): string {
  if (action.toolkitName) return action.toolkitName;
  const id = action.toolkit || toolkitOf(action.slug);
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : action.slug;
}

/** Toolkit labels in the order Composio returned them. */
export function toolkitLabels(actions: CatalogAction[], limit = 6): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    if (action.slug.startsWith("builtin.")) continue;
    const label = displayName(action);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [];
}

export function parseCatalogDecision(raw: string): CatalogDecision {
  let value: unknown;
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    value = parsed;
  } catch {
    const plan = parsePlan(raw);
    return plan.ok ? { kind: "direct", plan: plan.plan, reasoning: "" } : { kind: "invalid", reasoning: "" };
  }
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const reasoning = String(obj.reasoning ?? "");
  const action = String(obj.action ?? "");
  if (action === "search") {
    const toolkits = stringList(obj.toolkits);
    const capabilities = stringList(obj.capabilities);
    const queries = stringList(obj.queries);
    if (!toolkits.length && !capabilities.length && !queries.length) return { kind: "invalid", reasoning };
    return { kind: "search", toolkits, capabilities, queries, reasoning };
  }
  if (action === "ask") {
    const prompt = String(obj.prompt ?? "").trim();
    const choices = Array.isArray(obj.choices) ? obj.choices.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [];
    if (!prompt) return { kind: "invalid", reasoning };
    return {
      kind: "ask",
      question: { id: "q", prompt, choices, required: obj.required !== false, allowSkip: Boolean(obj.allowSkip) },
      reasoning,
      choicesOmitted: !Array.isArray(obj.choices),
    };
  }
  if (action === "propose") {
    const understanding = String(obj.understanding ?? "").trim();
    const steps = Array.isArray(obj.steps)
      ? obj.steps
          .map((item) => {
            const step = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            return { goal: String(step.goal ?? "").trim(), tool: String(step.tool ?? "").trim() };
          })
          .filter((step) => step.tool)
          .slice(0, 6)
      : [];
    return steps.length ? { kind: "propose", understanding, steps, reasoning } : { kind: "invalid", reasoning };
  }
  const plan = parsePlan(raw);
  return plan.ok ? { kind: "direct", plan: plan.plan, reasoning } : { kind: "invalid", reasoning };
}

export function proposalFromSteps(understanding: string, steps: MappedStep[]): Proposal {
  return {
    understanding,
    questions: [],
    steps: steps.map((step) => step.goal),
    mapped: steps,
    status: "proposed",
  };
}

export function describeHits(actions: CatalogAction[], connections: { toolkit: string; status: string }[]): string {
  if (!actions.length) return "Catalog results: none.";
  return [
    "Catalog results:",
    ...actions.slice(0, 30).map((action) => {
      const toolkit = action.toolkit || toolkitOf(action.slug);
      const connected =
        action.slug.startsWith("builtin.") ||
        (typeof action.connected === "boolean"
          ? action.connected
          : connections.some((connection) => connection.status === "active" && connection.toolkit.toLowerCase().replace(/[\s_-]+/g, "") === toolkit.replace(/[\s_-]+/g, "")));
      return `- ${action.slug} | ${displayName(action)} | ${connected ? "connected" : "not connected"} | ${(action.description ?? "").replace(/\s+/g, " ").slice(0, 140)}`;
    }),
  ].join("\n");
}
