import { gateDecision } from "./policy";
import { toolkitOf } from "./planning";
import type { Proposal } from "./types";
import type { TraceEntry } from "./types";

export type WorkflowStep = {
  toolkit: string;
  tool: string;
  goal: string;
  args: Record<string, unknown>;
  /** Argument keys whose values should be chosen again on the next run. */
  refresh: string[];
};

export type WorkflowOffer = {
  request: string;
  name: string;
  cadence: "manual" | "hourly" | "daily" | "weekly";
  steps: WorkflowStep[];
  requiredToolkits: string[];
  externalTools: string[];
};

const RELATIVE = /\b(today|tomorrow|yesterday|latest|newest|unread|this week|next week|now)\b/i;

function cadenceFor(request: string): WorkflowOffer["cadence"] {
  if (/\b(every hour|hourly)\b/i.test(request)) return "hourly";
  if (/\b(every week|weekly)\b/i.test(request)) return "weekly";
  if (/\b(every day|each day|once a day|daily|each morning)\b/i.test(request)) return "daily";
  return "manual";
}

function suggestName(request: string): string {
  const sentence = request.replace(/\s+/g, " ").trim();
  const cut = sentence.split(/[.?!]/)[0] ?? sentence;
  return cut.slice(0, 60) || "Saved workflow";
}

function splitArgs(args: Record<string, unknown>): { args: Record<string, unknown>; refresh: string[] } {
  const kept: Record<string, unknown> = {};
  const refresh: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && RELATIVE.test(value)) refresh.push(key);
    else kept[key] = value;
  }
  return { args: kept, refresh };
}

/**
 * A save offer exists only after real tool calls all succeeded.
 * A question, a failed step, or an approval that has not run yet does not qualify.
 */
function lastSuccessful(entries: TraceEntry[]): Map<string, TraceEntry> {
  const byTool = new Map<string, TraceEntry>();
  for (const entry of entries) {
    if (entry.ok && entry.tool) byTool.set(entry.tool, entry);
  }
  return byTool;
}

export function workflowOffer(input: { request: string; trace: TraceEntry[]; proposal: Proposal | null }): WorkflowOffer | null {
  const executed = input.trace.filter((entry) => entry.tool && !entry.queued && !entry.denied);
  if (!executed.length) return null;
  if (executed.some((entry) => !entry.ok)) return null;
  const byTool = lastSuccessful(executed);
  const planned = input.proposal?.mapped?.filter((step) => byTool.has(step.tool)) ?? [];
  const uniquePlanned = planned.filter((step, index) => planned.findIndex((item) => item.tool === step.tool) === index);
  const sources = uniquePlanned.length
    ? uniquePlanned.map((step) => ({ tool: step.tool, toolkit: step.toolkit, goal: step.goal, args: byTool.get(step.tool)?.args ?? {} }))
    : [...byTool.values()].map((entry) => ({ tool: entry.tool, toolkit: toolkitOf(entry.tool), goal: entry.tool, args: entry.args ?? {} }));
  const steps = sources.map((source) => {
    const split = splitArgs(source.args);
    return { toolkit: source.toolkit || toolkitOf(source.tool), tool: source.tool, goal: source.goal, args: split.args, refresh: split.refresh };
  });
  const requiredToolkits = [...new Set(steps.map((step) => step.toolkit).filter((toolkit) => toolkit && toolkit !== "builtin"))];
  return {
    request: input.request.replace(/\s+/g, " ").trim(),
    name: suggestName(input.request),
    cadence: cadenceFor(input.request),
    steps,
    requiredToolkits,
    externalTools: steps.filter((step) => gateDecision(step.tool).decision === "hold").map((step) => step.tool),
  };
}

/** Instructions for a later run. Relative values stay as instructions, not frozen text. */
export function pausedRunError(paused: boolean): string | null {
  return paused ? "This agent is paused. Resume it before running." : null;
}

export function savedStepsLine(steps: WorkflowStep[]): string {
  return `saved-steps:${JSON.stringify(steps)}`;
}

/** Steps carried on a scheduled run. A background run reads these instead of asking the planner to propose again. */
export function readSavedSteps(text: string): WorkflowStep[] {
  const match = text.match(/(?:^|\n)saved-steps:(\[.*\])(?:\n|$)/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const step = item as Partial<WorkflowStep>;
      if (typeof step.tool !== "string" || typeof step.goal !== "string") return [];
      return [
        {
          toolkit: typeof step.toolkit === "string" ? step.toolkit : toolkitOf(step.tool),
          tool: step.tool,
          goal: step.goal,
          args: step.args && typeof step.args === "object" && !Array.isArray(step.args) ? step.args : {},
          refresh: Array.isArray(step.refresh) ? step.refresh.filter((key): key is string => typeof key === "string") : [],
        },
      ];
    });
  } catch {
    return [];
  }
}

export function replayPrompt(workflow: WorkflowOffer): string {
  const lines = workflow.steps.map((step) => {
    const refresh = step.refresh.length ? ` Refresh these each run instead of reusing old values: ${step.refresh.join(", ")}.` : "";
    return `- ${step.tool} (${step.toolkit}): ${step.goal}.${refresh}`;
  });
  return [
    "Run this saved workflow again. Search the catalog for the same actions and follow them.",
    `Original request: ${workflow.request}`,
    "Resolved actions:",
    ...lines,
    "Do not invent apps. Do not search the web to discover tools.",
  ].join("\n");
}
