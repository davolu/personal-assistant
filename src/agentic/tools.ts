import { gateDecision } from "@/assistant/policy";
import { ASK_USER_TOOL } from "./ask";
import type { TraceStep } from "./types";
import { availableSearchProviders } from "./web-route";

export const TOOL_SCHEMAS = [
  {
    name: "search_tools",
    description: "Find app actions for a sub-task. Returns slugs, connection status, and pitfalls. Search again when the task changes.",
    input_schema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "object", properties: { use_case: { type: "string" } }, required: ["use_case"] },
        },
      },
      required: ["queries"],
    },
  },
  {
    name: "connect_app",
    description: "Check or start a connection for an app. Returns a connect link when the user must approve OAuth. Does not send, delete, or pay.",
    input_schema: {
      type: "object",
      properties: { toolkit: { type: "string", description: "The app slug to connect." } },
      required: ["toolkit"],
    },
  },
  {
    name: "execute_tools",
    description: "Run one or more app actions returned by search_tools. Sends, deletes, and payments wait for the user.",
    input_schema: {
      type: "object",
      properties: {
        tools: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool_slug: { type: "string" },
              arguments: { type: "object" },
            },
            required: ["tool_slug", "arguments"],
          },
        },
        thought: { type: "string" },
      },
      required: ["tools"],
    },
  },
  ASK_USER_TOOL,
  {
    name: "update_todo",
    description: "Rewrite the checklist the user can see. Use pending, in_progress, or done.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "done"] },
            },
            required: ["title", "status"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "remember",
    description: "Save one durable fact about the user, such as a preference. This is not permission to send or pay.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "recall",
    description: "Search long-term facts and past task summaries.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "web_search",
    description: "Search the public web. No connected account.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "research",
    description: "Read-only research helper for a heavier question. Returns a summary. It cannot send, delete, or pay.",
    input_schema: {
      type: "object",
      properties: { goal: { type: "string" } },
      required: ["goal"],
    },
  },
  {
    name: "schedule_task",
    description:
      "Propose a recurring run of a goal the user asked to repeat. Pass the goal and the cadence they described: daily at a time, weekdays, weekly on a day, every N hours, or a five-field cron. This pauses for approval and does not run the task now. Set allow_risky only when the user explicitly said sends, deletes, or payments may run without asking.",
    input_schema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "The task to repeat." },
        name: { type: "string", description: "Short name for the schedule." },
        cadence: { type: "string", description: "daily, weekdays, weekly, interval, or cron." },
        time: { type: "string", description: "Local time HH:MM for daily, weekdays, or weekly." },
        weekday: { type: "string", description: "Day name for a weekly cadence." },
        hours: { type: "number", description: "Interval length from 1 to 23." },
        cron: { type: "string", description: "Five-field cron when cadence is cron." },
        timezone: { type: "string", description: "IANA timezone. Use the user's zone when they named one." },
        notify: { type: "boolean", description: "Leave a result in the chat when a run finishes." },
        allow_risky: { type: "boolean", description: "True only when the user explicitly allowed unattended sends, deletes, or payments." },
      },
      required: ["goal", "cadence"],
    },
  },
  {
    name: "use_computer",
    description:
      "Use the user's cloud desktop when no Composio tool or API fits, for example a website with no API or a GUI app. Pass one narrow task. You get a summary and a screenshot back. Do not use this when search_tools already found an app action.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "One narrow desktop task." } },
      required: ["task"],
    },
  },
] as const;

export const FETCH_URL_TOOL = {
  name: "fetch_url",
  description: "Read one public http or https URL and return its text. No connected account.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "A public http or https URL." } },
    required: ["url"],
  },
};

export function searchWebTool(env: Record<string, string | undefined> = process.env) {
  const providers = availableSearchProviders(env);
  return {
    name: "search_web",
    description: `Search the public web with one provider. No connected account. provider is one of: ${providers.join(", ")}. If provider is omitted, duckduckgo is queried. The call uses that provider only.`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        provider: { type: "string", enum: providers, description: "The provider to query. Omit it for duckduckgo." },
      },
      required: ["query"],
    },
  };
}

export function agentToolSchemas(env: Record<string, string | undefined> = process.env) {
  return [...TOOL_SCHEMAS, searchWebTool(env), FETCH_URL_TOOL];
}

export type ToolOutcome = {
  content: string;
  isError: boolean;
  connect?: { app: string; url: string };
  effect?: TraceStep["effect"];
};

export interface ToolRuntime {
  searchTools(userId: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  connectApp(userId: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  executeTools(userId: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  webSearch(userId: string, query: string): Promise<ToolOutcome>;
  searchWeb(userId: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  fetchUrl(userId: string, url: string): Promise<ToolOutcome>;
  research(userId: string, goal: string): Promise<ToolOutcome>;
}

/** External sends, deletes, and payments hold. Reads and internal writes run. */
export function executionHolds(args: Record<string, unknown>): { hold: boolean; unknown: string[] } {
  const tools = Array.isArray(args.tools) ? args.tools : [];
  const unknown: string[] = [];
  let hold = false;
  for (const item of tools) {
    const slug = String((item as { tool_slug?: string }).tool_slug ?? "");
    if (!slug) continue;
    const gate = gateDecision(slug);
    if (gate.decision === "hold") hold = true;
    if (gate.decision === "deny") unknown.push(slug);
  }
  return { hold, unknown };
}

export function effectOfSlug(slug: string): TraceStep["effect"] {
  return gateDecision(slug).effect;
}
