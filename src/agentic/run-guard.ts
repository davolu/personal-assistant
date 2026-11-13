import { readBudgets } from "./budgets";
import type { RunGuard } from "./graph";
import {
  creditsExhaustedMessage,
  desktopLockedMessage,
  planAllowsDesktop,
  runBudgetMessage,
  type TokenUsage,
} from "@/lib/credits";
import { admitRun, balanceOf, chargeDesktop, chargeSearch, chargeUsage, ensureUserCredits, readBalance, releaseRun } from "@/lib/usage-store";

export type RunMeter = RunGuard & {
  chargeSearch(): Promise<void>;
  chargeDesktop(seconds: number): Promise<void>;
  allowDesktop(): Promise<string | null>;
  chargeClient(model: string, inputTokens: number, outputTokens: number): Promise<void>;
};

export async function openMeteredRun(userId: string, runId: string, kind: string, rate = true) {
  const admission = await admitRun({ userId, runId, kind, rate });
  if (!admission.ok) return admission;
  return { ok: true as const, plan: admission.plan, meter: createRunGuard(userId, runId), release: () => releaseRun(runId) };
}

/** Per-run spend cap and credit balance. One instance belongs to one invocation. */
export function createRunGuard(userId: string, runId: string): RunMeter {
  let spent = 0;
  const budget = readBudgets().taskBudgetUsd;

  function stopForSpend(remaining: number, unpriced: boolean): string | null {
    if (unpriced) return "That model is not available.";
    if (remaining <= 0) return creditsExhaustedMessage();
    if (spent >= budget) return runBudgetMessage();
    return null;
  }

  return {
    async beforeModel() {
      if (spent >= budget) return runBudgetMessage();
      const balance = await readBalance(userId);
      if (balance <= 0) return creditsExhaustedMessage();
      return null;
    },
    async afterModel(modelId, usage) {
      if (!usage) return spent >= budget ? runBudgetMessage() : null;
      const result = await chargeUsage({ userId, runId, model: modelId, usage });
      spent += result.costUsd;
      return stopForSpend(result.remaining, !result.ok);
    },
    async chargeSearch() {
      const result = await chargeSearch({ userId, runId });
      spent += result.costUsd;
    },
    async chargeDesktop(seconds) {
      const result = await chargeDesktop({ userId, runId, seconds });
      spent += result.costUsd;
    },
    async allowDesktop() {
      const user = await ensureUserCredits(userId);
      if (!user) return "Sign in first.";
      if (!planAllowsDesktop(user.plan)) return desktopLockedMessage();
      if (balanceOf(user) <= 0) return creditsExhaustedMessage();
      return null;
    },
    async chargeClient(model, inputTokens, outputTokens) {
      const usage: TokenUsage = { inputTokens, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens };
      const result = await chargeUsage({ userId, runId, model, usage });
      spent += result.costUsd;
    },
  };
}
