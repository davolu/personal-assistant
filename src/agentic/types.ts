/** Shared types for the model-driven agent. JSON-serializable so checkpoints can store them. */

export type TodoItem = {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
};

export type TraceStep = {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  effect: "read" | "write_internal" | "external" | "unknown";
  queued?: boolean;
  denied?: boolean;
  error?: string;
};

export type FailureEntry = {
  tool: string;
  args: Record<string, unknown>;
  outcome: string;
};

export type ConnectLink = { app: string; url: string };

export type AskOption = { label: string; value: string; description?: string };

export type TextBlock = { type: "text"; text: string };
export type ThinkingBlock = { type: "thinking"; thinking: string; signature?: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/png"; data: string };
};
export type ToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<TextBlock | ImageBlock>;
  is_error?: boolean;
};

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResult | ImageBlock;

export type AgenticMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

export type ComputerCheckpoint = {
  task: string;
  messages: AgenticMessage[];
  stepsUsed: number;
  lastScreenshot?: string;
  pausedCallId?: string;
};

export type Pending = {
  kind: "ask" | "approval" | "connect";
  toolUseId: string;
  question?: string;
  choices?: string[];
  options?: AskOption[];
  multiSelect?: boolean;
  allowCustom?: boolean;
  app?: string;
  url?: string;
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  digest?: string;
  siblingResults: ToolResult[];
  order: string[];
  computer?: ComputerCheckpoint;
  phase?: "resume-computer";
  resume?: { kind: "ask" | "approval"; text?: string; decision?: "approve" | "reject" | "edit"; args?: Record<string, unknown> };
};

export type ComputerRunResult =
  | { status: "done"; summary: string; screenshot?: string; streamUrl?: string | null; sandboxId?: string }
  | { status: "error"; message: string; streamUrl?: string | null; sandboxId?: string }
  | {
      status: "ask";
      question: string;
      choices: string[];
      options?: AskOption[];
      multiSelect?: boolean;
      allowCustom?: boolean;
      checkpoint: ComputerCheckpoint;
      streamUrl?: string | null;
      sandboxId?: string;
    }
  | {
      status: "approval";
      summary: string;
      action: Record<string, unknown>;
      checkpoint: ComputerCheckpoint;
      streamUrl?: string | null;
      sandboxId?: string;
    };

export type HoldKind = "ask" | "approval" | "connect";

export type HoldResolution = {
  decision: string;
  label: string;
  selected?: string[];
  args?: Record<string, unknown>;
  text?: string;
};

/** A question, approval, or connection that stays in the transcript until the user resolves it. */
export type Hold = {
  id: string;
  kind: HoldKind;
  status: "pending" | "resolved";
  at: number;
  toolUseId: string;
  question?: string;
  choices?: string[];
  options?: AskOption[];
  multiSelect?: boolean;
  allowCustom?: boolean;
  app?: string;
  url?: string;
  tool?: string;
  args?: Record<string, unknown>;
  summary?: string;
  digest?: string;
  computer?: ComputerCheckpoint;
  resolution?: HoldResolution;
  error?: string;
};

export type AgenticEvent =
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; status: "start" | "ok" | "error"; summary: string }
  | { type: "todo"; items: TodoItem[] }
  | { type: "connect"; id: string; app: string; url: string }
  | { type: "ask"; id: string; question: string; choices: string[]; options: AskOption[]; multiSelect: boolean; allowCustom: boolean }
  | { type: "approval"; id: string; tool: string; args: Record<string, unknown>; summary: string }
  | { type: "hold"; hold: Hold }
  | { type: "verify"; score: number; label: string; ungrounded: boolean; feedback: string }
  | { type: "computer"; streamUrl: string; sandboxId: string }
  | { type: "token"; text: string };

export type VerifyReport = {
  score: number;
  label: "fails" | "partial" | "meets";
  ungrounded: boolean;
  feedback: string;
};

export type HintLabel = "progress" | "empty" | "error" | "wrong tool" | "needs user" | "unsure";

export type RouteName = "agent" | "tools" | "verify" | "ask" | "approve" | "connect" | "end";
