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
export function workflowOffer(input: { request: string; trace: TraceEntry[]; proposal: Proposal | null }): WorkflowOffer | null {
  const executed = input.trace.filter((entry) => entry.tool && !entry.queued && !entry.denied);
  if (!executed.length) return null;
  if (executed.some((entry) => !entry.ok)) return null;
  const steps = executed.map((entry) => {
    const split = splitArgs(entry.args ?? {});
    const planned = input.proposal?.mapped?.find((step) => step.tool === entry.tool);
    return {
      toolkit: planned?.toolkit || toolkitOf(entry.tool),
      tool: entry.tool,
      goal: planned?.goal || entry.tool,
      args: split.args,
      refresh: split.refresh,
    };
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
