// Effect classification and the deny-by-default policy gate (Ch48, Ch65).
// The gate's decision depends ONLY on the tool slug and the agent's policy —
// never on message content, so injected text cannot widen permissions.

export type EffectClass = "read" | "write_internal" | "external" | "unknown";
export type GateDecision = "execute" | "hold" | "deny";

// Exact-slug overrides win over verb inference. Keep this list short and
// reviewed — it exists for slugs whose verbs lie about their effect.
const OVERRIDES: Record<string, EffectClass> = {
  // discovery/meta
  discover_tools: "read",
  // Composio built-in research is read-only despite varied verbs
  COMPOSIO_SEARCH_TAVILY: "read",
  COMPOSIO_SEARCH_DUCK_DUCK_GO: "read",
  COMPOSIO_SEARCH_NEWS: "read",
  COMPOSIO_SEARCH_FETCH_URL_CONTENT: "read",
  COMPOSIO_SEARCH_EXA_ANSWER: "read",
  // "POST" here means publish to the outside world
  INSTAGRAM_CREATE_POST: "external",
  INSTAGRAM_CREATE_MEDIA_CONTAINER: "write_internal", // staged, invisible until publish
};

// Verb groups, checked in order. External (reaches people / money / destroys)
// beats internal write beats read.
const EXTERNAL =
  /(^|_)(SEND|REPLY|PUBLISH|POST|SUBMIT|SHARE|FORWARD|BROADCAST|INVITE|PAY|TRANSFER|CHARGE|REFUND|PAYOUT|DELETE|REMOVE|TRASH|DESTROY|REVOKE|CANCEL|ARCHIVE_|BAN|KICK)(_|$)/;
const WRITE =
  /(^|_)(CREATE|ADD|UPDATE|INSERT|UPLOAD|APPEND|MOVE|COPY|SET|MARK|LABEL|DRAFT|EDIT|RENAME|MERGE|IMPORT|SCHEDULE|ASSIGN|COMPLETE|CLOSE|OPEN|START|STOP|PATCH|WRITE|SAVE|BATCH|INITIATE|RESOLVE|PIN|STAR|REACT|SNOOZE|TAG)(_|$)/;
const READ =
  /(^|_)(GET|LIST|SEARCH|FETCH|FIND|RETRIEVE|READ|QUERY|CHECK|LOOKUP|COUNT|DOWNLOAD|EXPORT|VIEW|SHOW|DESCRIBE|ACCESS|VALIDATE|VERIFY|POLL|STATUS|HISTORY|INFO)(_|$)/;

export function classifyEffect(tool: string): EffectClass {
  if (tool in OVERRIDES) return OVERRIDES[tool];
  const t = tool.toUpperCase();
  if (EXTERNAL.test(t)) return "external";
  if (WRITE.test(t)) return "write_internal";
  if (READ.test(t)) return "read";
  return "unknown";
}

/**
 * The single policy decision for every proposed tool call.
 * - reads and internal writes execute in both modes
 * - external effects execute only when the owner opted into auto mode
 * - unknown-class tools NEVER auto-execute: held for a human in both modes
 */
export function gateDecision(tool: string, approvalMode: string): GateDecision {
  const effect = classifyEffect(tool);
  if (effect === "read" || effect === "write_internal") return "execute";
  if (effect === "external") return approvalMode === "approve" ? "hold" : "execute";
  // unknown: deny-by-default manifests as "a human must look at it"
  return "hold";
}
