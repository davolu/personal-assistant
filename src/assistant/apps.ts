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
