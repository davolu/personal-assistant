import type { Plan, Proposal } from "./types";
import { parsePlan } from "./planner";
import { tokens } from "./util";

/** One catalog action. Names come from the host that listed them, never from a fixed table. */
export type CatalogAction = { slug: string; description?: string; toolkit?: string; toolkitName?: string };

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
};

export type CatalogDecision =
  | { kind: "direct"; plan: Plan; reasoning: string }
  | { kind: "search"; queries: string[]; reasoning: string }
  | { kind: "ask"; question: QuestionCard; reasoning: string }
  | { kind: "propose"; understanding: string; steps: { goal?: string; tool: string }[]; reasoning: string }
  | { kind: "invalid"; reasoning: string };

const MAKE = /^(make|create|generate|convert|write|compose|produce|build)$/;
const READ = /^(read|list|fetch|get|find|search|show|unread|inbox|latest|summarise|summarize)$/;

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

/** Token overlap against slug, description, and toolkit. Ambiguous names fall out of the data. */
export function matchCatalog(actions: CatalogAction[], queries: string[]): CatalogAction[] {
  const needles = [...new Set(queries.flatMap((query) => tokens(query)).filter((token) => token.length > 2))];
  if (!needles.length) return [];
  return actions
    .filter((action) => {
      const hay = `${action.slug} ${action.description ?? ""} ${action.toolkit ?? ""} ${action.toolkitName ?? ""} ${toolkitOf(action.slug)}`.toLowerCase();
      return needles.some((needle) => hay.includes(needle) || needle.includes(toolkitOf(action.slug)));
    })
    .slice(0, 40);
}

/** Toolkit labels in `actions` that a mention could refer to. Two or more means the model must ask. */
export function matchingToolkits(actions: CatalogAction[], mention: string): string[] {
  const needle = mention.toLowerCase();
  const names = new Map<string, string>();
  for (const action of actions) {
    const id = (action.toolkit || toolkitOf(action.slug)).toLowerCase();
    if (id.length < 3) continue;
    const label = displayName(action);
    if (id === needle || needle.startsWith(id) || id.startsWith(needle)) names.set(id, label);
  }
  return [...names.values()];
}

export function ambiguousMentions(brief: string, actions: CatalogAction[]): string[][] {
  const groups: string[][] = [];
  for (const word of tokens(brief)) {
    const matches = matchingToolkits(actions, word);
    if (matches.length > 1) groups.push(matches);
  }
  return groups;
}

/**
 * Generic verb tie-break, then description overlap with the step text.
 * No toolkit-specific bonuses.
 */
export function rankActions(actions: CatalogAction[], toolkit: string, intentText: string): CatalogAction | undefined {
  const hits = actions.filter((action) => (action.toolkit || toolkitOf(action.slug)) === toolkit.toLowerCase());
  const intentTokens = tokens(intentText);
  const making = intentTokens.some((token) => MAKE.test(token) || token.startsWith("generat") || token.startsWith("creat"));
  const reading = intentTokens.some((token) => READ.test(token));
  let best: { action: CatalogAction; score: number } | undefined;
  for (const action of hits) {
    const slug = action.slug.toUpperCase();
    let score = overlap(intentText, `${action.slug} ${action.description ?? ""}`);
    if (making) {
      if (/GENERATE|CREATE|CONVERT/.test(slug)) score += 8;
      if (/RETRIEVE|STATUS|LIST_|GET_|FETCH|DELETE|REMOVE|POLL|DETAIL/.test(slug)) score -= 12;
    }
    if (reading && !making) {
      if (/LIST|FETCH|GET_|SEARCH|FIND/.test(slug)) score += 8;
      if (/SEND_|DRAFT|DELETE/.test(slug)) score -= 8;
    }
    if (!best || score > best.score) best = { action, score };
  }
  return best?.action;
}

function overlap(intentText: string, haystack: string): number {
  const wanted = tokens(intentText);
  const have = tokens(haystack);
  let score = 0;
  for (const token of wanted) {
    if (have.includes(token)) score += 5;
    else if (have.some((item) => item.length > 3 && (token.startsWith(item) || item.startsWith(token)))) score += 3;
  }
  return score;
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
    const queries = Array.isArray(obj.queries) ? obj.queries.map((item) => String(item).trim()).filter(Boolean).slice(0, 4) : [];
    return queries.length ? { kind: "search", queries, reasoning } : { kind: "invalid", reasoning };
  }
  if (action === "ask") {
    const prompt = String(obj.prompt ?? "").trim();
    const choices = Array.isArray(obj.choices) ? obj.choices.map((item) => String(item).trim()).filter(Boolean).slice(0, 6) : [];
    if (!prompt) return { kind: "invalid", reasoning };
    return { kind: "ask", question: { id: "q", prompt, choices, required: obj.required !== false, allowSkip: Boolean(obj.allowSkip) }, reasoning };
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
      const connected = connections.some((connection) => connection.status === "active" && connection.toolkit.toLowerCase().replace(/[\s_-]+/g, "") === toolkit.replace(/[\s_-]+/g, ""));
      return `- ${action.slug} | ${displayName(action)} | ${connected ? "connected" : "not connected"} | ${(action.description ?? "").replace(/\s+/g, " ").slice(0, 140)}`;
    }),
  ].join("\n");
}
