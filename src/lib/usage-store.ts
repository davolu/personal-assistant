import { readBudgets } from "@/agentic/budgets";
import { prisma } from "@/lib/prisma";
import { PLANS } from "@/lib/site";
import { mailerConfigured, sendEmail } from "@/lib/email";
import {
  creditsForUsage,
  decideAdmission,
  desktopCredits,
  migratedPlanCredits,
  planKeyOf,
  readCreditLimits,
  roundCredits,
  shouldAlertDailySpend,
  splitSpend,
  usageFromUnknown,
  verifyEmailMessage,
  webSearchCredits,
  type TokenUsage,
} from "@/lib/credits";

type LedgerUser = {
  id: string;
  plan: string;
  emailVerified: boolean;
  runsQuota: number;
  runsUsed: number;
  creditBalance: { toString(): string } | number;
  topupBalance: { toString(): string } | number;
  creditsMigrated: boolean;
  nextBillingAt: Date | null;
};

export type ChargeResult = {
  ok: boolean;
  credits: number;
  costUsd: number;
  remaining: number;
  message?: string;
};

const userSelect = {
  id: true,
  plan: true,
  emailVerified: true,
  runsQuota: true,
  runsUsed: true,
  creditBalance: true,
  topupBalance: true,
  creditsMigrated: true,
  nextBillingAt: true,
} as const;

export async function ensureUserCredits(userId: string): Promise<LedgerUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (!user) return null;
  if (user.creditsMigrated) return user;
  const creditBalance = migratedPlanCredits(user);
  const plan = planKeyOf(user.plan);
  const nextBillingAt = user.nextBillingAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const updated = await prisma.user.updateMany({
    where: { id: userId, creditsMigrated: false },
    data: {
      creditBalance,
      creditsMigrated: true,
      runsQuota: PLANS[plan].credits,
      nextBillingAt,
    },
  });
  if (updated.count !== 1) {
    return prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  }
  return { ...user, creditBalance, creditsMigrated: true, runsQuota: PLANS[plan].credits, nextBillingAt };
}

export function balanceOf(user: { creditBalance: { toString(): string } | number; topupBalance: { toString(): string } | number }): number {
  return roundCredits(asNumber(user.creditBalance) + asNumber(user.topupBalance));
}

export async function readBalance(userId: string): Promise<number> {
  const user = await ensureUserCredits(userId);
  return user ? balanceOf(user) : 0;
}

export async function freeTierEligible(user: { id: string; plan: string; emailVerified: boolean }): Promise<boolean> {
  if (planKeyOf(user.plan) !== "free") return true;
  if (user.emailVerified) return true;
  const google = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "google" },
    select: { id: true },
  });
  return Boolean(google);
}

export async function admitRun(input: { userId: string; runId: string; kind: string; rate?: boolean }): Promise<
  { ok: true; plan: string; balance: number } | { ok: false; message: string }
> {
  const user = await ensureUserCredits(input.userId);
  if (!user) return { ok: false, message: "Sign in first." };
  const limits = readCreditLimits();
  const now = new Date();
  const eligible = await freeTierEligible(user);
  const activeRuns = await prisma.activeRun.count({
    where: { userId: input.userId, expiresAt: { gt: now }, NOT: { id: input.runId } },
  });
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const recentStarts = await prisma.usageLedger.count({
    where: {
      userId: input.userId,
      type: "admission",
      createdAt: { gte: since },
      NOT: { id: `admit:${input.runId}` },
    },
  });
  const decision = decideAdmission({
    balance: balanceOf(user),
    freeEligible: eligible,
    activeRuns,
    recentStarts,
    maxConcurrent: limits.maxConcurrent,
    maxPerHour: limits.maxPerHour,
    rate: input.rate !== false,
  });
  if (!decision.ok) {
    const message = decision.code === "verify" ? verifyEmailMessage(mailerConfigured()) : decision.message;
    return { ok: false, message };
  }
  const expiresAt = new Date(now.getTime() + readBudgets().wallClockMs + 60_000);
  await prisma.activeRun.upsert({
    where: { id: input.runId },
    create: { id: input.runId, userId: input.userId, kind: input.kind, expiresAt },
    update: { expiresAt, kind: input.kind },
  });
  if (input.rate !== false) {
    await prisma.usageLedger.upsert({
      where: { id: `admit:${input.runId}` },
      create: {
        id: `admit:${input.runId}`,
        userId: input.userId,
        runId: input.runId,
        type: "admission",
        units: { kind: input.kind },
        credits: 0,
        costUsd: 0,
      },
      update: {},
    });
  }
  return { ok: true, plan: planKeyOf(user.plan), balance: balanceOf(user) };
}

export async function releaseRun(runId: string): Promise<void> {
  await prisma.activeRun.deleteMany({ where: { id: runId } });
}

export async function chargeUsage(input: { userId: string; runId: string; model: string; usage: TokenUsage }): Promise<ChargeResult> {
  const priced = creditsForUsage(input.model, input.usage);
  if (!priced) {
    return { ok: false, credits: 0, costUsd: 0, remaining: await readBalance(input.userId), message: "That model is not available." };
  }
  return debit({
    userId: input.userId,
    runId: input.runId,
    type: "model",
    model: input.model,
    credits: priced.credits,
    costUsd: priced.costUsd,
    units: input.usage,
  });
}

export async function chargeReportedUsage(input: { userId: string; runId: string; model: string; usage: unknown }): Promise<ChargeResult> {
  const parsed = usageFromUnknown(input.usage);
  if (!parsed) return { ok: true, credits: 0, costUsd: 0, remaining: await readBalance(input.userId) };
  return chargeUsage({ userId: input.userId, runId: input.runId, model: input.model, usage: parsed.usage });
}

export async function chargeSearch(input: { userId: string; runId: string }): Promise<ChargeResult> {
  const credits = webSearchCredits();
  return debit({
    userId: input.userId,
    runId: input.runId,
    type: "web_search",
    model: "",
    credits,
    costUsd: credits / 100,
    units: { searches: 1 },
  });
}

export async function chargeDesktop(input: { userId: string; runId: string; seconds: number }): Promise<ChargeResult> {
  const priced = desktopCredits(input.seconds);
  return debit({
    userId: input.userId,
    runId: input.runId,
    type: "desktop",
    model: "",
    credits: priced.credits,
    costUsd: priced.costUsd,
    units: { seconds: input.seconds },
  });
}

async function debit(input: {
  userId: string;
  runId: string;
  type: string;
  model: string;
  credits: number;
  costUsd: number;
  units: unknown;
}): Promise<ChargeResult> {
  await ensureUserCredits(input.userId);
  const split = await prisma.$transaction(async (db) => {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true, topupBalance: true, creditsMigrated: true },
    });
    if (!user) return null;
    const next = splitSpend(asNumber(user.creditBalance), asNumber(user.topupBalance), input.credits);
    await db.user.update({
      where: { id: input.userId },
      data: { creditBalance: next.plan, topupBalance: next.topup },
    });
    await db.usageLedger.create({
      data: {
        userId: input.userId,
        runId: input.runId,
        type: input.type,
        model: input.model.slice(0, 120),
        units: input.units as object,
        credits: next.charged,
        costUsd: input.credits > 0 ? (next.charged / input.credits) * input.costUsd : 0,
      },
    });
    return next;
  });
  if (!split) return { ok: false, credits: 0, costUsd: 0, remaining: 0, message: "Sign in first." };
  await maybeAlertDailySpend().catch((err) => console.error("[spend-alert]", err instanceof Error ? err.message : err));
  return { ok: true, credits: split.charged, costUsd: input.costUsd, remaining: split.remaining };
}

async function maybeAlertDailySpend(): Promise<void> {
  const limits = readCreditLimits();
  const day = new Date().toISOString().slice(0, 10);
  const existing = await prisma.spendAlert.findUnique({ where: { day } });
  const start = new Date(`${day}T00:00:00.000Z`);
  const sum = await prisma.usageLedger.aggregate({
    where: { createdAt: { gte: start }, type: { in: ["model", "web_search", "desktop"] } },
    _sum: { costUsd: true },
  });
  const spentUsd = asNumber(sum._sum.costUsd ?? 0);
  if (!shouldAlertDailySpend(spentUsd, limits.dailySpendUsd, Boolean(existing))) return;
  console.error(`[spend-alert] metered provider cost today is $${spentUsd.toFixed(2)}, above $${limits.dailySpendUsd.toFixed(2)}`);
  await prisma.spendAlert.create({ data: { day, spentUsd } }).catch(() => undefined);
  if (limits.alertEmail) {
    const text = `Metered provider cost for ${day} is $${spentUsd.toFixed(2)}, above the $${limits.dailySpendUsd.toFixed(2)} daily threshold.`;
    await sendEmail({
      to: limits.alertEmail,
      subject: `AgentDocker spend alert: $${spentUsd.toFixed(2)} today`,
      text,
      html: `<p>${text}</p>`,
    });
  }
}

export async function recentUsage(userId: string, take = 8) {
  const rows = await prisma.usageLedger.findMany({
    where: { userId, type: { in: ["model", "web_search", "desktop"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, credits: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    credits: asNumber(row.credits),
    at: row.createdAt.toISOString(),
  }));
}

function asNumber(value: { toString(): string } | number | null): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}
