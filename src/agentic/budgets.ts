export type Budgets = {
  maxToolCalls: number;
  maxApproaches: number;
  compactChars: number;
  wallClockMs: number;
  computerSteps: number;
  taskBudgetUsd: number;
};

export function readBudgets(env: Record<string, string | undefined> = process.env): Budgets {
  return {
    maxToolCalls: positive(env.AGENTIC_MAX_TOOL_CALLS, 40),
    maxApproaches: positive(env.AGENTIC_MAX_APPROACHES, 3),
    compactChars: positive(env.AGENTIC_COMPACT_CHARS, 80_000),
    wallClockMs: positive(env.AGENTIC_WALL_CLOCK_MS, 10 * 60 * 1000),
    computerSteps: positive(env.AGENTIC_COMPUTER_STEPS, 12),
    taskBudgetUsd: Number(env.AGENTIC_TASK_BUDGET_USD || 1),
  };
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A failed attempt's identity. Repeating it is the same approach, not a new one. */
export function approachKey(tool: string, args: Record<string, unknown>): string {
  if (tool === "execute_tools") {
    const tools = Array.isArray(args.tools) ? args.tools : [];
    const slugs = tools
      .map((item) => String((item as { tool_slug?: string }).tool_slug ?? ""))
      .filter(Boolean)
      .sort();
    return `execute:${slugs.join("+") || "unknown"}`;
  }
  if (tool === "web_search" || tool === "search_tools" || tool === "use_computer" || tool === "research") {
    const text = String(args.query ?? args.task ?? args.goal ?? args.use_case ?? "").slice(0, 48);
    return `${tool}:${text}`;
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
