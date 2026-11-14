import type { TokenUsage } from "@/lib/credits";
import { parseAskInput, ASK_USER_TOOL, type AskPrompt } from "./ask";
import { COMPUTER_STEP_BUDGET } from "./budgets";
import { resumeComputerCheckpoint } from "./computer-continue";
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
  complete(input: { system: string; messages: AgenticMessage[]; signal?: AbortSignal }): Promise<ComputerTurn>;
}

/** Base64 screenshots larger than this are not stored in checkpoints or tool results. */
export const MAX_STORED_SCREENSHOT = 2_000_000;

export function storedScreenshot(data: string | undefined): string | undefined {
  if (!data || data.length > MAX_STORED_SCREENSHOT) return undefined;
  return data;
}

export function withDeadline<T>(work: Promise<T>, ms: number | undefined, message: string): Promise<T> {
  if (!ms || ms <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
  /** Stop this invocation after this many milliseconds and return a checkpoint. */
  sliceMs?: number;
  /** Bound one model call or desktop action. A hang returns an error result. */
  callTimeoutMs?: number;
  now?: () => number;
}): Promise<ComputerRunResult> {
  const maxSteps = Math.min(opts.maxSteps ?? COMPUTER_STEP_BUDGET, COMPUTER_STEP_BUDGET);
  const checkpoint = resumeComputerCheckpoint(opts.checkpoint, { sandboxId: opts.desktop.sandboxId });
  const messages: AgenticMessage[] = checkpoint?.messages
    ? checkpoint.messages.map((message) => ({ ...message, content: message.content }))
    : [{ role: "user", content: opts.task }];
  let stepsUsed = checkpoint?.stepsUsed ?? 0;
  let lastScreenshot = checkpoint?.lastScreenshot;
  let lastNarration = "";
  const meta = { streamUrl: opts.desktop.streamUrl, sandboxId: opts.desktop.sandboxId };
  const now = opts.now ?? Date.now;
  const sliceStarted = now();
  const stepsAtStart = stepsUsed;
  const callTimeoutMs = opts.callTimeoutMs;
  const finish = async (kind: "done" | "error", text: string): Promise<ComputerRunResult> => {
    const view = await captureDesktopView(opts.desktop, lastScreenshot, callTimeoutMs);
    const note = view.dropped ? " The screenshot was too large to store." : "";
    const body = `${text}${note}`;
    const fields = { ...(view.screenshot ? { screenshot: view.screenshot } : {}), ...(view.url ? { url: view.url } : {}), ...(view.title ? { title: view.title } : {}) };
    if (kind === "error") return { status: "error", message: body, ...meta, ...fields };
    return { status: "done", summary: body, ...meta, ...fields };
  };
  const snapshot = (): ComputerCheckpoint => {
    omitOlderScreenshots(messages);
    return persistCheckpoint({ task: opts.task, messages, stepsUsed, sandboxId: opts.desktop.sandboxId, ...(lastScreenshot ? { lastScreenshot } : {}) });
  };
  const sliceUsed = () => opts.sliceMs != null && stepsUsed > stepsAtStart && now() - sliceStarted >= opts.sliceMs && stepsUsed < maxSteps;

  if (checkpoint?.pausedCallId && opts.resume) {
    const applied = await applyResume(messages, checkpoint.pausedCallId, opts.resume, opts.desktop, callTimeoutMs);
    if (applied.screenshot) lastScreenshot = applied.screenshot;
    if (!applied.ok && applied.halt) {
      return finish("error", applied.message);
    }
  }

  while (stepsUsed < maxSteps) {
    if (sliceUsed()) {
      return { status: "continue", summary: "The desktop is still working.", checkpoint: snapshot(), ...meta, ...(storedScreenshot(lastScreenshot) ? { screenshot: storedScreenshot(lastScreenshot) } : {}) };
    }
    omitOlderScreenshots(messages);
    let turn: ComputerTurn;
    try {
      const controller = new AbortController();
      const timer = callTimeoutMs ? setTimeout(() => controller.abort(), callTimeoutMs) : undefined;
      try {
        turn = await withDeadline(
          opts.model.complete({ system: COMPUTER_SYSTEM, messages, signal: controller.signal }),
          callTimeoutMs,
          "The desktop model timed out."
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "AbortError" || /timed out|aborted/i.test(err.message));
      const message = timedOut ? "The desktop model timed out." : err instanceof Error ? err.message : "Computer model failed";
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
          checkpoint: { task: opts.task, messages, stepsUsed, lastScreenshot, pausedCallId: call.id, sandboxId: meta.sandboxId },
          ...meta,
        };
      }
      const ran = await runOne(action, opts.desktop, callTimeoutMs);
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
  desktop: DesktopHandle,
  timeoutMs?: number
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
      const ran = await runOne(action, desktop, timeoutMs);
      if (ran.screenshot) screenshot = ran.screenshot;
      results.push(ran.ok ? textResult(call.id, ran.message) : toolError(call.id, ran.message));
      continue;
    }
    const action = normalizeComputerCall(call.name, call.input);
    if (!action || action.kind === "ask_user") {
      results.push(toolError(call.id, "Not executed: an earlier computer action in this turn failed."));
      continue;
    }
    const ran = await runOne(action, desktop, timeoutMs);
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
    checkpoint: { task, messages, stepsUsed, lastScreenshot, pausedCallId, sandboxId: meta.sandboxId },
    ...meta,
  };
}

async function runOne(
  action: NormalizedAction,
  desktop: DesktopHandle,
  timeoutMs?: number
): Promise<{ ok: boolean; message: string; screenshot?: string; block?: ToolResultShape }> {
  try {
    if (action.kind === "screenshot" || action.kind === "zoom") {
      const data = await withDeadline(desktop.screenshot(), timeoutMs, "The desktop action timed out.");
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
    await withDeadline(desktop.perform(action), timeoutMs, "The desktop action timed out.");
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
  const shot = storedScreenshot(result.screenshot);
  if (!shot) {
    const note = result.screenshot ? "\nThe screenshot was too large to store." : "";
    return { type: "tool_result", tool_use_id: toolUseId, content: `${text}${note}`, ...error };
  }
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    ...error,
    content: [
      { type: "text", text },
      { type: "image", source: { type: "base64", media_type: "image/png", data: shot } },
    ],
  };
}

/** One screenshot, small enough to checkpoint. Drops pictures that would blow the stored state. */
export function persistCheckpoint(checkpoint: ComputerCheckpoint): ComputerCheckpoint {
  const messages = checkpoint.messages.map((message) => shrinkStoredImages({ ...message, content: message.content }));
  omitOlderScreenshots(messages);
  const lastScreenshot = storedScreenshot(checkpoint.lastScreenshot);
  return {
    task: checkpoint.task,
    messages,
    stepsUsed: checkpoint.stepsUsed,
    ...(lastScreenshot ? { lastScreenshot } : {}),
    ...(checkpoint.pausedCallId ? { pausedCallId: checkpoint.pausedCallId } : {}),
    ...(checkpoint.sandboxId ? { sandboxId: checkpoint.sandboxId } : {}),
  };
}

function shrinkStoredImages(message: AgenticMessage): AgenticMessage {
  if (!Array.isArray(message.content)) return message;
  const content: ContentBlock[] = message.content.map((block) => {
    if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
    let dropped = false;
    const parts: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }> = [];
    for (const part of block.content) {
      if (part.type !== "image") {
        parts.push(part);
        continue;
      }
      if (storedScreenshot(part.source.data)) parts.push(part);
      else dropped = true;
    }
    if (!dropped) return { ...block, content: parts };
    const text = parts.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
    return { ...block, content: text ? `${text}\nThe screenshot was too large to store.` : "The screenshot was too large to store." };
  });
  return { ...message, content };
}

async function captureDesktopView(
  desktop: DesktopHandle,
  fallback?: string,
  timeoutMs?: number
): Promise<{ screenshot?: string; url?: string; title?: string; dropped?: boolean }> {
  let screenshot = storedScreenshot(fallback);
  let dropped = Boolean(fallback && !screenshot);
  try {
    const fresh = await withDeadline(desktop.screenshot(), timeoutMs, "The desktop action timed out.");
    const kept = storedScreenshot(fresh);
    if (kept) screenshot = kept;
    else if (fresh) dropped = true;
  } catch {
    // Keep the last screenshot captured during the loop.
  }
  let url = "";
  let title = "";
  if (desktop.observe) {
    try {
      const seen = await withDeadline(desktop.observe(), timeoutMs ? Math.min(timeoutMs, 8_000) : undefined, "The desktop action timed out.");
      url = seen.url?.trim() ?? "";
      title = seen.title?.trim() ?? "";
    } catch {
      // The window title and URL are optional. A hang must not stall the tool result.
    }
  }
  return {
    ...(screenshot ? { screenshot } : {}),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(dropped ? { dropped } : {}),
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
