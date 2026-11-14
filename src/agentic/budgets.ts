export type Budgets = {
  maxToolCalls: number;
  maxApproaches: number;
  compactChars: number;
  wallClockMs: number;
  computerSteps: number;
  taskBudgetUsd: number;
};

/**
 * Desktop actions inside one use_computer call.
 * Opening a browser, loading a page, scrolling, clicking a link, and reading
 * the result is about 15 actions, and the desktop model usually checks with a
 * screenshot around each one, so 36 finishes that task in one call and leaves
 * room for a retry. Older screenshots are dropped before the next step, which
 * keeps a full call under the run's dollar budget (taskBudgetUsd, default $1).
 */
export const COMPUTER_STEP_BUDGET = 36;

export function readBudgets(env: Record<string, string | undefined> = process.env): Budgets {
  return {
    maxToolCalls: positive(env.AGENTIC_MAX_TOOL_CALLS, 40),
    maxApproaches: positive(env.AGENTIC_MAX_APPROACHES, 3),
    compactChars: positive(env.AGENTIC_COMPACT_CHARS, 80_000),
    wallClockMs: positive(env.AGENTIC_WALL_CLOCK_MS, 10 * 60 * 1000),
    computerSteps: COMPUTER_STEP_BUDGET,
    taskBudgetUsd: Number(env.AGENTIC_TASK_BUDGET_USD || 1),
  };
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A failed attempt's identity. Counts the tool, not the query or URL.
 * Two searches that differ only by wording are one approach, so the budget
 * does not ask the user while other tools are still unused. execute_tools
 * keeps the action slugs, because those are different tools.
 */
export function approachKey(tool: string, args: Record<string, unknown>): string {
  if (tool === "execute_tools") {
    const tools = Array.isArray(args.tools) ? args.tools : [];
    const slugs = tools
      .map((item) => String((item as { tool_slug?: string }).tool_slug ?? ""))
      .filter(Boolean)
      .sort();
    return `execute:${slugs.join("+") || "unknown"}`;
  }
  return tool;
}

export function rememberApproach(approaches: string[], key: string): string[] {
  if (approaches.includes(key)) return approaches;
  return [...approaches, key];
}

export function overApproachBudget(approaches: string[], budgets: Budgets): boolean {
  return approaches.length >= budgets.maxApproaches;
}

/** Gaps longer than this between graph steps are parked time, not active work. */
export const ACTIVE_IDLE_MS = 2_000;

export type ActiveClock = { startedAt?: number; activeMs?: number; touchedAt?: number };

export function activeElapsed(input: ActiveClock, now: number): number {
  const banked = Math.max(0, input.activeMs ?? 0);
  const started = input.startedAt ?? 0;
  if (started <= 0) return banked;
  return banked + Math.max(0, now - started);
}

/** Freeze the clock. Waiting and parked gaps must not add to the next check. */
export function pauseActiveClock(input: ActiveClock, now: number): { startedAt: number; activeMs: number } {
  return { startedAt: 0, activeMs: activeElapsed(input, now) };
}

export function openActiveClock(now: number, activeMs = 0): { startedAt: number; activeMs: number } {
  return { startedAt: now, activeMs: Math.max(0, activeMs) };
}

/**
 * Continue a run after a gap. Time after the last step stamp is parked
 * (a question, an approval, a reload, or another request) and is not billed.
 */
export function settleActiveClock(input: ActiveClock, now: number, idleMs = ACTIVE_IDLE_MS): { startedAt: number; activeMs: number; touchedAt: number } {
  const started = input.startedAt ?? 0;
  const activeMs = Math.max(0, input.activeMs ?? 0);
  const touched = input.touchedAt ?? 0;
  if (started > 0 && touched > started && now - touched > idleMs) {
    return { startedAt: now, activeMs: activeMs + (touched - started), touchedAt: now };
  }
  if (started <= 0) return { startedAt: now, activeMs, touchedAt: now };
  return { startedAt: started, activeMs, touchedAt: now };
}

export type BudgetIntent = "continue" | "stop";

/** Button values from the budget card. Free text is classified by the model. */
export function knownBudgetIntent(answer: string): BudgetIntent | null {
  const value = answer.trim().toLowerCase();
  if (value === "continue" || value === "keep going") return "continue";
  if (value === "stop" || value === "stop here") return "stop";
  return null;
}

export function budgetIntentFromModel(text: string): BudgetIntent {
  const first = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first === "stop" ? "stop" : "continue";
}
