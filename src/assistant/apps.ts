import type { Plan, ToolSpec } from "./types";
import { tokens } from "./util";

/** Product words that should not, on their own, select an app. "mail" must not match Zoho Mail. */
const GENERIC = new Set([
  "mail",
  "email",
  "books",
  "desk",
  "inventory",
  "calendar",
  "docs",
  "drive",
  "sheets",
  "slides",
  "ads",
  "search",
  "maps",
  "photos",
  "crm",
]);

/** Apps named in the user's text. A brand token such as "zoho" matches every Zoho toolkit. */
export function appsMentioned(text: string, catalog: string[]): string[] {
  const words = new Set(tokens(text));
  return catalog.filter((name) => tokens(name).some((part) => !GENERIC.has(part) && words.has(part)));
}

const VIDEO_APPS = ["Runway", "HeyGen", "Descript"];

/** Video requests need a video toolkit even when the user never says the product name. */
export function capabilityApps(text: string, catalog: string[]): string[] {
  if (!/\b(video|videos)\b/i.test(text)) return [];
  const have = new Set(catalog.map((name) => name.toLowerCase()));
  return VIDEO_APPS.filter((name) => have.has(name.toLowerCase()));
}

export function claimsNoTools(text: string): boolean {
  return /don'?t have (a |the )?(tool|tools)|no tool to|i don't have the tools|zapier|make\.com|apps script/i.test(text);
}

export function looksLikeAgentBrief(text: string): boolean {
  return /\bagent\b/i.test(text);
}

export function createAgentHref(text: string): string {
  return `/create?idea=${encodeURIComponent(text.trim().slice(0, 500))}`;
}

/** Used when the planner's JSON cannot be accepted. Never the only sentence "I couldn't make a plan". */
export function helpfulFallback(text: string): string {
  const parts = ["I can still help with that."];
  if (looksLikeAgentBrief(text)) {
    parts.push(`This reads like an agent to build. Open the builder with your description filled in: ${createAgentHref(text)}`);
  } else {
    parts.push("What should the first result look like? I can do it with a connected app, or ask one question if something is missing.");
  }
  if (/\b(video|videos)\b/i.test(text)) {
    parts.push("Generating video needs a video app such as Runway, HeyGen, or Descript. If one of those is not connected yet, use the connect link.");
  }
  return parts.join("\n\n");
}

export function unconnectedApps(text: string, catalog: string[], connectedNames: string[]): string[] {
  const connected = new Set(connectedNames.map((name) => name.toLowerCase()));
  const named = appsMentioned(text, catalog).filter((name) => !connected.has(name.toLowerCase()));
  const extra = capabilityApps(text, catalog).filter((name) => !connected.has(name.toLowerCase()));
  return [...new Set([...named, ...extra])];
}

/**
 * The lexical allowlist drops GMAIL_SEND_EMAIL when the user says "mail" instead of "email".
 * If the request is clearly a send, keep a send tool for a connected mail app.
 */
export function ensureActionTools(query: string, listed: ToolSpec[], selected: ToolSpec[]): ToolSpec[] {
  const words = new Set(tokens(query));
  const wantsSend = ["send", "email", "mail", "message"].some((word) => words.has(word));
  if (!wantsSend) return selected;
  const send = listed.find((tool) => /(^|[._])SEND([._]|$)/.test(tool.name.toUpperCase()) && /GMAIL|MAIL|EMAIL|SLACK/.test(tool.name.toUpperCase()));
  if (!send || selected.some((tool) => tool.name === send.name)) return selected;
  return [send, ...selected].slice(0, 8);
}

export function nudgePlan(
  plan: Plan,
  input: { text: string; catalog?: string[]; connections: { toolkit: string; status: string }[] }
): Plan {
  const connected = input.connections.filter((connection) => connection.status === "active").map((connection) => connection.toolkit);
  const missing = unconnectedApps(input.text, input.catalog ?? [], connected);
  if (missing.length > 0 && plan.intent === "chat") {
    return {
      intent: "act",
      success: plan.success || "offer a connect link",
      steps: [{ id: "connect", goal: `connect ${missing.join(" ")}`, toolQuery: `connect ${missing.join(" ")}` }],
    };
  }
  const words = new Set(tokens(input.text));
  if (/\b(every day|once a day|daily|each morning)\b/i.test(input.text) && plan.intent === "chat") {
    return {
      intent: "act",
      success: plan.success || "schedule the recurring task",
      steps: [{ id: "s1", goal: "search the web and create a daily routine that emails the owner", toolQuery: "web search grants email schedule routine" }],
    };
  }
  const wantsSend = ["send", "email", "mail"].some((word) => words.has(word));
  const hasMailbox = connected.some((name) => /gmail|outlook|mail/i.test(name));
  if (wantsSend && hasMailbox && plan.intent === "chat") {
    return {
      intent: "act",
      success: plan.success || "prepare the email for approval",
      steps: [{ id: "s1", goal: "send an email from the connected mailbox", toolQuery: "send email gmail" }],
    };
  }
  return plan;
}

export function withConnectTool(selected: ToolSpec[], listed: ToolSpec[], needed: boolean): ToolSpec[] {
  if (!needed) return selected;
  const connect = listed.find((tool) => tool.name === "builtin.apps.connect");
  if (!connect || selected.some((tool) => tool.name === connect.name)) return selected;
  return [connect, ...selected].slice(0, 8);
}
