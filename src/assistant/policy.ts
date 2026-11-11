import type { EffectClass, GateDecision } from "./types";

/**
 * Effect classification and the deny-by-default gate (Ch48).
 * The decision depends only on the tool name and the effect our own code declared.
 * Message content is never an argument, so injected text cannot widen permissions.
 */

const OVERRIDES: Record<string, EffectClass> = {
  "builtin.clock.now": "read",
  "builtin.notes.search": "read",
  "builtin.docs.search": "read",
  "builtin.notes.add": "write_internal",
  "builtin.memory.remember": "write_internal",
  "builtin.apps.connect": "write_internal",
};

const EXTERNAL =
  /(^|[._])(SEND|REPLY|PUBLISH|POST|SUBMIT|SHARE|FORWARD|BROADCAST|INVITE|PAY|TRANSFER|CHARGE|REFUND|PAYOUT|DELETE|REMOVE|TRASH|DESTROY|REVOKE|CANCEL|BAN|KICK)([._]|$)/;
const WRITE =
  /(^|[._])(CREATE|ADD|UPDATE|INSERT|UPLOAD|APPEND|MOVE|COPY|SET|MARK|LABEL|DRAFT|EDIT|RENAME|MERGE|IMPORT|SCHEDULE|ASSIGN|COMPLETE|CLOSE|OPEN|START|STOP|PATCH|WRITE|SAVE|BATCH|PIN|STAR|REACT|SNOOZE|TAG|REMEMBER)([._]|$)/;
const READ =
  /(^|[._])(GET|LIST|SEARCH|FETCH|FIND|RETRIEVE|READ|QUERY|CHECK|LOOKUP|COUNT|DOWNLOAD|EXPORT|VIEW|SHOW|DESCRIBE|POLL|STATUS|HISTORY|INFO|NOW)([._]|$)/;

export function classifyEffect(tool: string): EffectClass {
  if (tool in OVERRIDES) return OVERRIDES[tool];
  const t = tool.toUpperCase();
  if (EXTERNAL.test(t)) return "external";
  if (WRITE.test(t)) return "write_internal";
  if (READ.test(t)) return "read";
  return "unknown";
}

/** Name-derived effect wins when it is known, so a provider cannot relabel a send as a read. */
export function resolveEffect(tool: string, declared?: EffectClass): EffectClass {
  const fromName = classifyEffect(tool);
  if (fromName !== "unknown") return fromName;
  return declared ?? "unknown";
}

const RANK: Record<EffectClass, number> = { unknown: 0, read: 1, write_internal: 2, external: 3 };

export function stricter(a: EffectClass, b: EffectClass): EffectClass {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Reads and internal writes execute.
 * External effects (send, delete, pay, and the other verbs above) always hold for a person.
 * Unknown effects deny. There is no auto-approve mode in v1.
 */
export function gateDecision(tool: string, declared?: EffectClass): { decision: GateDecision; effect: EffectClass } {
  const effect = resolveEffect(tool, declared);
  if (effect === "read" || effect === "write_internal") return { decision: "execute", effect };
  if (effect === "external") return { decision: "hold", effect };
  return { decision: "deny", effect };
}
