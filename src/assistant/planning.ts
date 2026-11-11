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
  /** OAuth URL from the Tool Router session, when the toolkit is not connected. */
  connectUrl?: string;
  /** Short argument list from the Composio action schema, for a later run to fill missing values. */
  schemaHint?: string;
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
  connectUrl?: string;
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

const OUTPUTS: { label: string; words: RegExp }[] = [
  { label: "video file", words: /\b(videos?|clips?|animations?|animated)\b/i },
  { label: "image file", words: /\b(images?|pictures?|photos?)\b/i },
  { label: "audio file", words: /\b(audio|podcasts?|songs?)\b/i },
  { label: "spreadsheet", words: /\b(spreadsheets?|csv)\b/i },
  { label: "document", words: /\b(documents?|pdfs?)\b/i },
];

/** The kind of file the user asked for, taken from their words rather than an app name. */
export function namedOutput(text: string): string | null {
  for (const output of OUTPUTS) {
    if (output.words.test(text)) return output.label;
  }
  return null;
}

/** Keep the original output in the search after a short clarifying answer. */
export function withOutputQuery(queries: string[], brief: string): string[] {
  const output = namedOutput(brief);
  const limited = queries.slice(0, 4);
  if (!output) return limited;
  const head = output.split(" ")[0]?.toLowerCase() ?? "";
  if (!head || limited.some((query) => query.toLowerCase().includes(head))) return limited;
  return [`create a ${output}`, ...limited].slice(0, 4);
}

/** Remind the planner that a later answer does not change the requested output. */
export function outputCarryNote(brief: string, answer: string): string {
  const output = namedOutput(brief);
  if (!output) return "";
  const latest = answer.trim();
  const answered = latest && latest !== brief.trim() ? ` The latest message ("${latest.slice(0, 160)}") answers a question. It does not change the requested output.` : "";
  return `\nThe user asked for a ${output}.${answered} Prefer actions whose descriptions produce a ${output}.`;
}

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

function compactName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when two toolkit labels are the same word or differ by at most two characters. */
function namesClose(left: string, right: string): boolean {
  const a = compactName(left);
  const b = compactName(right);
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) && longer.length - shorter.length <= 2;
}

/** Toolkit display names in the search hits that one word in the brief could refer to. */
export function ambiguousToolkitGroups(brief: string, actions: CatalogAction[]): string[][] {
  const toolkits = new Map<string, string>();
  for (const action of actions) {
    if (action.slug.startsWith("builtin.")) continue;
    const slug = (action.toolkit || toolkitOf(action.slug)).toLowerCase();
    if (slug) toolkits.set(slug, displayName(action));
  }
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const word of brief.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length < 4) continue;
    const hits = [...toolkits.entries()].filter(([slug, name]) => namesClose(word, slug) || name.toLowerCase().split(/[^a-z0-9]+/).some((part) => namesClose(word, part)));
    if (hits.length < 2) continue;
    const labels = hits.map(([, name]) => name);
    const key = [...labels].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(labels);
  }
  return groups;
}

/** Exact word match, so a short answer does not also count as a longer nearby name. */
export function textNamesToolkit(text: string, label: string): boolean {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).map(compactName).filter((word) => word.length >= 4);
  const parts = [compactName(label), ...label.toLowerCase().split(/[^a-z0-9]+/).map(compactName)];
  return words.some((word) => parts.includes(word));
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
    ...actions.slice(0, 40).map((action) => {
      const toolkit = action.toolkit || toolkitOf(action.slug);
      const connected =
        action.slug.startsWith("builtin.") ||
        (typeof action.connected === "boolean"
          ? action.connected
          : connections.some((connection) => connection.status === "active" && connection.toolkit.toLowerCase().replace(/[\s_-]+/g, "") === toolkit.replace(/[\s_-]+/g, "")));
      return `- ${action.slug} | ${displayName(action)} | ${action.toolkit || toolkitOf(action.slug)} | ${connected ? "connected" : "not connected"} | ${(action.description ?? "").replace(/\s+/g, " ").slice(0, 220)}`;
    }),
  ].join("\n");
}
