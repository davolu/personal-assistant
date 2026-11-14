import type { TokenUsage } from "@/lib/credits";
import { parseAskInput, ASK_USER_TOOL, type AskPrompt } from "./ask";
import { COMPUTER_STEP_BUDGET } from "./budgets";
import { COMPUTER_SYSTEM } from "./prompts";
import type { AgenticMessage, AskOption, ComputerCheckpoint, ComputerRunResult, ContentBlock, ToolResult, ToolUseBlock } from "./types";

export const DISPLAY = { width: 1024, height: 768 };

export type NormalizedAction = {
  kind: string;
  coordinate?: [number, number];
  start?: [number, number];
  text?: string;
  direction?: string;
  amount?: number;
  repeat?: number;
  question?: string;
  choices?: string[];
  options?: AskOption[];
  multiSelect?: boolean;
  allowCustom?: boolean;
};

export type ComputerTurn = {
  content: ContentBlock[];
  usage?: TokenUsage;
};

export interface ComputerModel {
  complete(input: { system: string; messages: AgenticMessage[] }): Promise<ComputerTurn>;
}

export interface DesktopHandle {
  sandboxId: string;
  streamUrl: string | null;
  screenshot(): Promise<string>;
  perform(action: NormalizedAction): Promise<void>;
  /** Active window title, and the page URL when the desktop can see one. */
  observe?(): Promise<{ url?: string; title?: string }>;
}

const RISKY = /\b(submit(?:ting|ted)?|sends?|sending|pay(?:ing|ment)?|purchase|checkout|place order|transfer|post this|deletes?|deleting)\b/i;
const ENTER = /^(return|enter|ctrl\+enter|control\+enter)$/i;

/** Approval is about the desktop action, not about whether to open the desktop. */
export function actionNeedsApproval(action: NormalizedAction, narration: string): boolean {
  const blob = `${narration}\n${action.kind} ${action.text ?? ""}`;
  if (action.kind === "screenshot" || action.kind === "mouse_move" || action.kind === "scroll" || action.kind === "cursor_position" || action.kind === "zoom" || action.kind === "wait") {
    return false;
  }
  if (action.kind === "key" && ENTER.test(action.text ?? "") && RISKY.test(blob)) return true;
  if ((action.kind === "left_click" || action.kind === "double_click") && RISKY.test(narration)) return true;
  return false;
}

export function computerToolForModel(model: string): { tools: Record<string, unknown>[]; betas: string[] } {
  const ask = ASK_USER_TOOL;
  if (/claude-(?:opus|sonnet|haiku)-5(?:[^\d]|$)|fable-5|mythos/i.test(model)) {
    return { tools: [{ type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } }, ask], betas: [] };
  }
  if (/sonnet-4-5|haiku-4-5|opus-4-1|(?:^|[^.\d])claude-(?:sonnet|opus)-4$/i.test(model) || /claude-3/i.test(model)) {
    return {
      tools: [
        { type: "computer_20250124", name: "computer", display_width_px: DISPLAY.width, display_height_px: DISPLAY.height },
        ask,
      ],
      betas: ["computer-use-2025-01-24"],
    };
  }
  return {
    tools: [
      {
        type: "computer_20251124",
        name: "computer",
        display_width_px: DISPLAY.width,
        display_height_px: DISPLAY.height,
        enable_zoom: false,
      },
      ask,
    ],
    betas: ["computer-use-2025-11-24"],
  };
}

export function normalizeComputerCall(name: string, input: Record<string, unknown>): NormalizedAction | null {
  if (name === "ask_user") {
    const ask = parseAskInput({
      ...input,
      question: String(input.question ?? "Take over the desktop, then tell me to continue."),
    });
    return { kind: "ask_user", ...ask };
  }
  const source: Record<string, unknown> = name === "computer" ? { ...input, kind: String(input.action ?? "screenshot") } : { ...input, kind: name };
  const kind = String(source.kind ?? "");
  if (!kind) return null;
  const coordinate = pair(source.coordinate);
  const start = pair(source.start_coordinate);
  return {
    kind,
    ...(coordinate ? { coordinate } : {}),
    ...(start ? { start } : {}),
    text: String(source.text ?? source.key ?? ""),
    direction: typeof source.scroll_direction === "string" ? source.scroll_direction : undefined,
    amount: typeof source.scroll_amount === "number" ? source.scroll_amount : undefined,
    repeat: typeof source.repeat === "number" ? source.repeat : undefined,
  };
}

function pair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

export async function runComputerLoop(opts: {
  task: string;
  desktop: DesktopHandle;
  model: ComputerModel;
  maxSteps?: number;
  checkpoint?: ComputerCheckpoint;
  resume?: { kind: "ask" | "approval"; text?: string; decision?: "approve" | "reject" | "edit" };
  onUsage?: (usage: TokenUsage) => Promise<string | null>;
}): Promise<ComputerRunResult> {
  const maxSteps = Math.min(opts.maxSteps ?? COMPUTER_STEP_BUDGET, COMPUTER_STEP_BUDGET);
  const messages: AgenticMessage[] = opts.checkpoint?.messages
    ? opts.checkpoint.messages.map((message) => ({ ...message, content: message.content }))
    : [{ role: "user", content: opts.task }];
  let stepsUsed = opts.checkpoint?.stepsUsed ?? 0;
  let lastScreenshot = opts.checkpoint?.lastScreenshot;
  let lastNarration = "";
  const meta = { streamUrl: opts.desktop.streamUrl, sandboxId: opts.desktop.sandboxId };
  const finish = async (kind: "done" | "error", text: string): Promise<ComputerRunResult> => {
    const view = await captureDesktopView(opts.desktop, lastScreenshot);
    if (kind === "error") return { status: "error", message: text, ...meta, ...view };
    return { status: "done", summary: text, ...meta, ...view };
  };

  if (opts.checkpoint?.pausedCallId && opts.resume) {
    const applied = await applyResume(messages, opts.checkpoint.pausedCallId, opts.resume, opts.desktop);
    if (applied.screenshot) lastScreenshot = applied.screenshot;
    if (!applied.ok && applied.halt) {
      return finish("error", applied.message);
    }
  }

  while (stepsUsed < maxSteps) {
    omitOlderScreenshots(messages);
    let turn: ComputerTurn;
    try {
      turn = await opts.model.complete({ system: COMPUTER_SYSTEM, messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Computer model failed";
      return finish("error", message);
    }
    messages.push({ role: "assistant", content: turn.content });
    if (turn.usage && opts.onUsage) {
      const stop = await opts.onUsage(turn.usage);
      if (stop) return finish("error", stop);
    }
    const calls = turn.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
    if (calls.length === 0) {
      return finish("done", textOf(turn.content) || "Desktop task finished.");
    }
    const narration = textOf(turn.content);
    if (narration) lastNarration = narration;
    const results: ContentBlock[] = [];
    let halted = false;
    for (const call of calls) {
      if (halted) {
        results.push(toolError(call.id, "Not executed: an earlier computer action in this turn failed."));
        continue;
      }
      const action = normalizeComputerCall(call.name, call.input);
      if (!action) {
        results.push(toolError(call.id, `Unknown computer action ${call.name}.`));
        halted = true;
        continue;
      }
      if (action.kind === "ask_user") {
        return pauseAsk(opts.task, messages, stepsUsed, lastScreenshot, call.id, actionAsAsk(action), meta);
      }
      if (stepsUsed > 0 && /\b(sign[\s-]?in|log[\s-]?in|password|2fa|two-factor|captcha|verification code)\b/i.test(narration) && action.kind !== "screenshot") {
        return pauseAsk(
          opts.task,
          messages,
          stepsUsed,
          lastScreenshot,
          call.id,
          parseAskInput({ question: "I need you to take over the desktop for sign-in, 2FA, or a captcha. Use the live view, then tell me to continue." }),
          meta
        );
      }
      if (actionNeedsApproval(action, narration)) {
        return {
          status: "approval",
          summary: `Desktop action needs approval: ${action.kind}${action.text ? ` ${action.text}` : ""}. ${narration}`.slice(0, 400),
          action: { ...action },
          checkpoint: { task: opts.task, messages, stepsUsed, lastScreenshot, pausedCallId: call.id },
          ...meta,
        };
      }
      const ran = await runOne(action, opts.desktop);
      stepsUsed += 1;
      if (ran.screenshot) lastScreenshot = ran.screenshot;
      if (!ran.ok) {
        results.push(toolError(call.id, ran.message));
        halted = true;
        continue;
      }
      results.push(ran.block ? { ...ran.block, tool_use_id: call.id } as ContentBlock : textResult(call.id, ran.message));
    }
    messages.push({ role: "user", content: shrinkImages(results) });
  }
  const what = lastNarration ? `Last action: ${lastNarration.slice(0, 400)}` : `Completed ${stepsUsed} desktop steps.`;
  return finish("done", `Stopped because the computer step budget was reached. ${what}`);
}

async function applyResume(
  messages: AgenticMessage[],
  pausedCallId: string,
  resume: { kind: "ask" | "approval"; text?: string; decision?: "approve" | "reject" | "edit" },
  desktop: DesktopHandle
): Promise<{ ok: boolean; halt?: boolean; message: string; screenshot?: string }> {
  const last = messages[messages.length - 1];
  const calls = last && last.role === "assistant" && Array.isArray(last.content) ? last.content.filter((block): block is ToolUseBlock => block.type === "tool_use") : [];
  const paused = calls.find((call) => call.id === pausedCallId);
  const results: ContentBlock[] = [];
  let started = false;
  let screenshot: string | undefined;
  for (const call of calls) {
    if (call.id !== pausedCallId && !started) {
      results.push(toolError(call.id, "Not executed: the turn paused before this action."));
      continue;
    }
    if (call.id === pausedCallId) {
      started = true;
      if (resume.kind === "ask") {
        results.push(textResult(call.id, resume.text || "The user took over the desktop and says to continue."));
        continue;
      }
      if (resume.decision === "reject") {
        results.push(toolError(call.id, "The user rejected this desktop action. Do not submit, pay, or send."));
        continue;
      }
      const action = paused ? normalizeComputerCall(paused.name, paused.input) : null;
      if (!action) {
        results.push(toolError(call.id, "The approved desktop action could not be read."));
        continue;
      }
      const ran = await runOne(action, desktop);
      if (ran.screenshot) screenshot = ran.screenshot;
      results.push(ran.ok ? textResult(call.id, ran.message) : toolError(call.id, ran.message));
      continue;
    }
    const action = normalizeComputerCall(call.name, call.input);
    if (!action || action.kind === "ask_user") {
      results.push(toolError(call.id, "Not executed: an earlier computer action in this turn failed."));
      continue;
    }
    const ran = await runOne(action, desktop);
    if (ran.screenshot) screenshot = ran.screenshot;
    results.push(ran.ok ? (ran.block ? ({ ...ran.block, tool_use_id: call.id } as ContentBlock) : textResult(call.id, ran.message)) : toolError(call.id, ran.message));
  }
  if (!paused) {
    results.push(textResult(pausedCallId, resume.text || "Continue."));
  }
  messages.push({ role: "user", content: results });
  return { ok: true, message: "resumed", screenshot };
}

function actionAsAsk(action: NormalizedAction): AskPrompt {
  return parseAskInput({
    question: action.question,
    choices: action.choices,
    options: action.options,
    multiSelect: action.multiSelect,
    allowCustom: action.allowCustom,
  });
}

function pauseAsk(
  task: string,
  messages: AgenticMessage[],
  stepsUsed: number,
  lastScreenshot: string | undefined,
  pausedCallId: string,
  ask: AskPrompt,
  meta: { streamUrl: string | null; sandboxId: string }
): ComputerRunResult {
  return {
    status: "ask",
    question: ask.question,
    choices: ask.choices,
    options: ask.options,
    multiSelect: ask.multiSelect,
    allowCustom: ask.allowCustom,
    checkpoint: { task, messages, stepsUsed, lastScreenshot, pausedCallId },
    ...meta,
  };
}

async function runOne(
  action: NormalizedAction,
  desktop: DesktopHandle
): Promise<{ ok: boolean; message: string; screenshot?: string; block?: ToolResultShape }> {
  try {
    if (action.kind === "screenshot" || action.kind === "zoom") {
      const data = await desktop.screenshot();
      return {
        ok: true,
        message: "screenshot",
        screenshot: data,
        block: {
          type: "tool_result",
          tool_use_id: "",
          content: [{ type: "image", source: { type: "base64", media_type: "image/png", data } }],
        },
      };
    }
    await desktop.perform(action);
    return { ok: true, message: "OK" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Desktop action failed" };
  }
}

type ToolResultShape = {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }>;
  is_error?: boolean;
};

function textResult(id: string, text: string): ToolResultShape {
  return { type: "tool_result", tool_use_id: id, content: text };
}

function toolError(id: string, text: string): ToolResultShape {
  return { type: "tool_result", tool_use_id: id, content: text, is_error: true };
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Text the outer model reads, plus the final screenshot as an image block when one exists. */
export function computerStatusText(result: Extract<ComputerRunResult, { status: "done" | "error" }>): string {
  const summary = result.status === "done" ? result.summary.trim() : "";
  const lead =
    result.status === "error"
      ? `Stopped because of an error: ${result.message.trim() || "The desktop action failed."}`
      : summary.startsWith("Stopped because")
        ? summary
        : `The desktop run finished. ${summary || "No further detail was reported."}`;
  const lines = [lead];
  if (result.title) lines.push(`Window: ${result.title}`);
  if (result.url) lines.push(`URL: ${result.url}`);
  return lines.join("\n");
}

export function computerToolResult(toolUseId: string, result: Extract<ComputerRunResult, { status: "done" | "error" }>): ToolResult {
  const text = computerStatusText(result);
  const error = result.status === "error" ? { is_error: true as const } : {};
  if (!result.screenshot) return { type: "tool_result", tool_use_id: toolUseId, content: text, ...error };
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    ...error,
    content: [
      { type: "text", text },
      { type: "image", source: { type: "base64", media_type: "image/png", data: result.screenshot } },
    ],
  };
}

async function captureDesktopView(desktop: DesktopHandle, fallback?: string): Promise<{ screenshot?: string; url?: string; title?: string }> {
  let screenshot = fallback;
  try {
    const fresh = await desktop.screenshot();
    if (fresh) screenshot = fresh;
  } catch {
    // Keep the last screenshot captured during the loop.
  }
  let url = "";
  let title = "";
  if (desktop.observe) {
    try {
      const seen = await desktop.observe();
      url = seen.url?.trim() ?? "";
      title = seen.title?.trim() ?? "";
    } catch {
      // The window title and URL are optional.
    }
  }
  return {
    ...(screenshot ? { screenshot } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

/** Keep one screenshot in the desktop transcript so later steps stay inside the run's dollar budget. */
function omitOlderScreenshots(messages: AgenticMessage[]): void {
  let latest = -1;
  messages.forEach((message, index) => {
    if (messageHasScreenshot(message)) latest = index;
  });
  messages.forEach((message, index) => {
    if (index === latest || !Array.isArray(message.content)) return;
    if (!messageHasScreenshot(message)) return;
    messages[index] = {
      ...message,
      content: message.content.map((block) => {
        if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
        if (!block.content.some((part) => part.type === "image")) return block;
        const text = block.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        return { ...block, content: text || "Earlier screenshot omitted. The latest screenshot is attached separately." };
      }),
    };
  });
}

function messageHasScreenshot(message: AgenticMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some(
    (block) => block.type === "tool_result" && Array.isArray(block.content) && block.content.some((part) => part.type === "image")
  );
}

function shrinkImages(blocks: ContentBlock[]): ContentBlock[] {
  let seen = 0;
  const images = blocks.filter((block) => block.type === "tool_result" && Array.isArray(block.content) && block.content.some((part) => part.type === "image")).length;
  return blocks.map((block) => {
    if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
    const hasImage = block.content.some((part) => part.type === "image");
    if (!hasImage) return block;
    seen += 1;
    if (seen < images) {
      return { ...block, content: "Earlier screenshot omitted. The latest screenshot is attached separately." };
    }
    return block;
  });
}
