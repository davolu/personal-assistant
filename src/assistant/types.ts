/** Shared contracts for the personal assistant. The model proposes values of these types; code decides. */

export const STOP_REASONS = [
  "MODEL_ANSWER",
  "ABSTAIN",
  "STEP_BUDGET",
  "TOKEN_BUDGET",
  "COST_BUDGET",
  "RATE_LIMIT",
  "WAITING_APPROVAL",
  "WAITING_EXPIRED",
  "DENIED",
  "REJECTED",
  "INPUT_BLOCKED",
  "FAILED",
  "MODEL_UNAVAILABLE",
  "LOOP_DETECTED",
] as const;

export type StopReason = (typeof STOP_REASONS)[number];

export type EffectClass = "read" | "write_internal" | "external" | "unknown";
export type GateDecision = "execute" | "hold" | "deny";

export type ResultEnvelope = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
  truncated?: boolean;
};

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Declared by our provider code. The policy gate still re-derives the effect from the name. */
  effect: EffectClass;
  provider: "builtin" | "mcp" | "composio";
};

export type ActionProposal = {
  tool: string;
  args: Record<string, unknown>;
  effectClass: EffectClass;
  idempotencyKey: string;
};

export type PlanStep = {
  id: string;
  goal: string;
  toolQuery: string;
  delegate?: "research" | "email" | "coding";
};

export type Plan = {
  intent: "chat" | "act" | "answer_from_docs";
  success: string;
  steps: PlanStep[];
};

export type TraceEntry = {
  tool: string;
  ok: boolean;
  effect: EffectClass;
  args: Record<string, unknown>;
  error?: string;
  queued?: boolean;
  denied?: boolean;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type MemoryItem = {
  id: string;
  text: string;
  sourceId?: string;
  embedding?: number[];
};

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRecord = {
  id: string;
  userId: string;
  taskId: string;
  tool: string;
  args: Record<string, unknown>;
  digest: string;
  status: ApprovalStatus;
  expiresAt: string;
  idempotencyKey: string;
};

export type Checkpoint = {
  plan: Plan;
  nextStep: number;
  trace: TraceEntry[];
  observations: string[];
  inputTokens: number;
  outputTokens: number;
  held?: { approvalId: string; stepIndex: number; tool: string; args: Record<string, unknown>; idempotencyKey: string };
};

export type Span = {
  id: string;
  parentId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, string | number | boolean>;
};

export type ModelRole = "plan" | "act" | "classify" | "summarize" | "embed";

export type ModelRequest = {
  role: ModelRole;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
};

export type ModelResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
};

export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export interface ToolProvider {
  id: "builtin" | "mcp" | "composio";
  /** When set, overrides the default prefix routing. Used so each MCP server owns its own tool names. */
  handles?: (name: string) => boolean;
  list(userId: string, query: string): Promise<ToolSpec[]>;
  call(userId: string, name: string, args: Record<string, unknown>): Promise<ResultEnvelope>;
}

export type RunEvent =
  | { type: "status"; text: string }
  | { type: "tool"; tool: string; ok: boolean; queued?: boolean; denied?: boolean }
  | { type: "approval"; approval: { id: string; tool: string; args: Record<string, unknown>; expiresAt: string } };

export type Quota = {
  dailySpendUsd: number;
  dailyLimitUsd: number;
  recentTurns: number;
  recentLimit: number;
};
