import { digestOf } from "@/assistant/util";
import type { AskOption, Hold, HoldKind, Pending } from "./types";

/** Hidden from the transcript. The model still sees it. */
export const HOLD_UPDATE_PREFIX = "Hold update:";

export type { Hold, HoldKind };

export type GateResolution = {
  id?: string;
  decision?: string;
  text?: string;
  args?: Record<string, unknown>;
  selected?: string[];
  defer?: boolean;
  declined?: boolean;
  connected?: boolean;
};

export type TurnPlan =
  | { mode: "defer"; resume: { defer: true; text: string; id?: string } }
  | { mode: "legacy"; resume: GateResolution }
  | { mode: "resolve"; resolution: GateResolution }
  | { mode: "message"; text: string }
  | { mode: "empty" };

export function holdFromPending(pending: Pending, at = -1): Hold {
  return {
    id: pending.toolUseId,
    kind: pending.kind,
    status: "pending",
    at,
    toolUseId: pending.toolUseId,
    question: pending.question,
    choices: pending.choices,
    options: pending.options,
    multiSelect: pending.multiSelect,
    allowCustom: pending.allowCustom,
    app: pending.app,
    url: pending.url,
    tool: pending.tool,
    args: pending.args,
    summary: pending.summary || pending.question || (pending.app ? `Connect ${pending.app}` : undefined),
    digest: pending.digest,
    computer: pending.computer,
  };
}

export function waitingNote(hold: Pick<Hold, "kind" | "summary" | "question" | "app">): string {
  const what = hold.summary || hold.question || hold.app || "this";
  if (hold.kind === "approval") {
    return `Waiting for the user to approve or reject (${what}). Nothing was sent, deleted, or paid. A later chat message does not approve or reject it. Do not claim it happened.`;
  }
  if (hold.kind === "ask") {
    return `Waiting for the user to answer on the question card: ${what}. A later chat message is a new request, not the answer, unless a hold update says they answered.`;
  }
  return `Waiting for the user to connect or decline (${what}). A later chat message does not decide this. Do not assume it is connected.`;
}

export function isDefer(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { defer?: unknown }).defer === true);
}

export function decisionLabel(kind: HoldKind, input: GateResolution): string {
  if (kind === "approval") {
    if (input.decision === "approve") return "Approved";
    if (input.decision === "edit") return "Edited and approved";
    return "Rejected";
  }
  if (kind === "connect") {
    const declined = input.declined === true || input.connected === false || input.decision === "decline" || input.decision === "reject";
    return declined ? "Declined" : "Connected";
  }
  const selected = (input.selected ?? []).map((item) => item.trim()).filter(Boolean);
  if (selected.length) return selected.join(", ");
  const text = (input.text || input.decision || "").trim();
  return text || "Answered";
}

export function normalizeResolution(kind: HoldKind, value: unknown): {
  defer: boolean;
  followUp: string;
  decision: string;
  label: string;
  args?: Record<string, unknown>;
  selected?: string[];
  text?: string;
  id?: string;
} {
  const record = value && typeof value === "object" ? (value as GateResolution) : {};
  const id = typeof record.id === "string" && record.id ? record.id : undefined;
  if (record.defer === true) {
    return { defer: true, followUp: textOf(record.text), decision: "", label: "", id };
  }
  if (kind === "approval") {
    const decision = record.decision === "approve" || record.decision === "edit" ? record.decision : "reject";
    return {
      defer: false,
      followUp: "",
      decision,
      label: decisionLabel(kind, { ...record, decision }),
      args: record.args,
      text: textOf(record.text),
      id,
    };
  }
  if (kind === "connect") {
    const declined = record.declined === true || record.connected === false || record.decision === "decline" || record.decision === "reject";
    const decision = declined ? "decline" : "connect";
    return { defer: false, followUp: "", decision, label: decisionLabel(kind, { ...record, decision }), text: textOf(record.text), id };
  }
  const selected = (record.selected ?? []).map((item) => String(item).trim()).filter(Boolean);
  const text = textOf(record.text) || (record.decision && record.decision !== "approve" && record.decision !== "reject" ? record.decision : "") || selected.join(", ");
  const picked = selected.length ? selected : text ? [text] : [];
  return { defer: false, followUp: "", decision: text, label: decisionLabel(kind, { ...record, text, selected: picked }), selected: picked, text, id };
}

/** A new chat message never approves, rejects, or answers a waiting card. */
export function planTurn(input: { interrupted: boolean; interruptValue?: unknown; text: string; resolve?: GateResolution | null }): TurnPlan {
  const resolve = input.resolve && typeof input.resolve === "object" ? input.resolve : null;
  if (resolve && input.interrupted) return { mode: "legacy", resume: { ...resolve, id: resolve.id || stableHoldId(input.interruptValue) } };
  if (resolve) return { mode: "resolve", resolution: resolve };
  const text = input.text.trim();
  if (input.interrupted && text) return { mode: "defer", resume: { defer: true, text, id: stableHoldId(input.interruptValue) } };
  if (text) return { mode: "message", text };
  return { mode: "empty" };
}

export function stableHoldId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) return record.id;
  if (typeof record.toolUseId === "string" && record.toolUseId) return record.toolUseId;
  if (typeof record.digest === "string" && record.digest) return record.digest;
  const kind = record.kind;
  if (kind !== "ask" && kind !== "approval" && kind !== "connect") return undefined;
  return digestOf({ kind, question: record.question ?? "", summary: record.summary ?? "", app: record.app ?? "", url: record.url ?? "", args: record.args ?? null }).slice(0, 24);
}

export function holdFromInterrupt(value: unknown): Hold | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "approval" || record.kind === "ask" || record.kind === "connect" ? record.kind : null;
  if (!kind) return null;
  const id = stableHoldId(record);
  if (!id) return null;
  const options = Array.isArray(record.options) ? (record.options as AskOption[]) : undefined;
  return {
    id,
    kind,
    status: "pending",
    at: -1,
    toolUseId: typeof record.toolUseId === "string" ? record.toolUseId : id,
    question: typeof record.question === "string" ? record.question : undefined,
    choices: Array.isArray(record.choices) ? record.choices.map((item) => String(item)) : undefined,
    options,
    multiSelect: record.multiSelect === true,
    allowCustom: record.allowCustom === true,
    app: typeof record.app === "string" ? record.app : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    tool: typeof record.tool === "string" ? record.tool : undefined,
    args: record.args && typeof record.args === "object" ? (record.args as Record<string, unknown>) : undefined,
    summary: typeof record.summary === "string" ? record.summary : typeof record.question === "string" ? record.question : undefined,
    digest: typeof record.digest === "string" ? record.digest : undefined,
    budget: record.budget === true ? true : undefined,
  };
}

export function mergeHolds(saved: Hold[], interrupts: unknown[]): Hold[] {
  const byId = new Map(saved.map((hold) => [hold.id, hold]));
  for (const value of interrupts) {
    const hold = holdFromInterrupt(value);
    if (hold && !byId.has(hold.id)) byId.set(hold.id, hold);
  }
  return [...byId.values()];
}

export function placeOpenHolds(holds: Hold[], at: number): Hold[] {
  return holds.map((hold) => (hold.at < 0 ? { ...hold, at } : hold));
}

export function upsertHold(holds: Hold[], hold: Hold): Hold[] {
  const index = holds.findIndex((item) => item.id === hold.id);
  if (index < 0) return [...holds, hold];
  return holds.map((item, i) => (i === index ? hold : item));
}

export function resolutionEventName(input: { kind?: string; decision?: string; connected?: boolean; declined?: boolean }): string {
  if (input.kind === "approval") return "agentic/approval.resolved";
  if (input.kind === "connect") return "agentic/connect.resolved";
  if (input.kind === "ask") return "agentic/ask.answered";
  if (input.decision === "approve" || input.decision === "edit" || input.decision === "reject") return "agentic/approval.resolved";
  if (typeof input.connected === "boolean" || input.declined === true) return "agentic/connect.resolved";
  return "agentic/ask.answered";
}

/** Why a durable run should wait. Budget questions park a hold instead of interrupting. */
export function parkedHoldPause(
  holds: Hold[] | undefined,
  interrupt: unknown
): { kind: string; id?: string; budget: boolean; via: "interrupt" | "hold" } | null {
  if (interrupt && typeof interrupt === "object") {
    const record = interrupt as { kind?: string; id?: string; toolUseId?: string };
    const kind = record.kind === "approval" || record.kind === "connect" || record.kind === "ask" ? record.kind : "ask";
    const id = typeof record.id === "string" ? record.id : typeof record.toolUseId === "string" ? record.toolUseId : undefined;
    return { kind, id, budget: false, via: "interrupt" };
  }
  const pending = (holds ?? []).find((hold) => hold.status === "pending");
  if (!pending) return null;
  return { kind: pending.kind, id: pending.id, budget: pending.budget === true, via: "hold" };
}

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/column\s+["']?[\w.]+["']?\s+does not exist|relation\s+["']?[\w.]+["']?\s+does not exist|syntax error/i.test(message)) {
    console.error("[agentic]", message.slice(0, 300));
  }
  return "That could not be completed. It is still waiting, so you can try again.";
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
