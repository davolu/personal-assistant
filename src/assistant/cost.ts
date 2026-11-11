/** Published list prices are estimates used for budgets, not invoices. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-5": { in: 3 / 1_000_000, out: 15 / 1_000_000 },
  "claude-haiku-4-5": { in: 1 / 1_000_000, out: 5 / 1_000_000 },
  "gpt-4o-mini": { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
  "text-embedding-3-small": { in: 0.02 / 1_000_000, out: 0 },
};

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? { in: 3 / 1_000_000, out: 15 / 1_000_000 };
  return inputTokens * price.in + outputTokens * price.out;
}

export function allowSpend(dailySpendUsd: number, dailyLimitUsd: number, nextCallEstimate = 0): boolean {
  return dailySpendUsd + nextCallEstimate < dailyLimitUsd;
}

export function allowRate(recentTurns: number, recentLimit: number): boolean {
  return recentTurns < recentLimit;
}
