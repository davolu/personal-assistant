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
  return parts.join("\n\n");
}

export function unconnectedApps(text: string, catalog: string[], connectedNames: string[]): string[] {
  const connected = new Set(connectedNames.map((name) => name.toLowerCase()));
  return appsMentioned(text, catalog).filter((name) => !connected.has(name.toLowerCase()));
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

/** The model chooses chat versus act. This no longer rewrites the plan from keywords. */
export function nudgePlan(plan: Plan, _input: { text: string; catalog?: string[]; connections: { toolkit: string; status: string }[] }): Plan {
  return plan;
}

export function withConnectTool(selected: ToolSpec[], listed: ToolSpec[], needed: boolean): ToolSpec[] {
  if (!needed) return selected;
  const connect = listed.find((tool) => tool.name === "builtin.apps.connect");
  if (!connect || selected.some((tool) => tool.name === connect.name)) return selected;
  return [connect, ...selected].slice(0, 8);
}
