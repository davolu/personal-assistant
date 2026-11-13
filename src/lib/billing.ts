import { prisma } from "@/lib/prisma";
import { CREDIT_TOPUP, PLANS, isPlanKey, type PlanKey } from "@/lib/site";
import { verifyTransaction } from "@/lib/paystack";

export { isPlanKey };
export const NGN_RATE = Number(process.env.NGN_RATE || 1600);
export const usdToKobo = (usd: number) => Math.round(usd * NGN_RATE) * 100;

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function nextBillingDate(from = Date.now()): Date {
  return new Date(from + MONTH_MS);
}

/** Apply a paid plan after successful checkout. Monthly credits reset; top-up credits stay. */
export async function applyPlan(userId: string, plan: PlanKey) {
  const p = PLANS[plan];
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan,
      planStatus: "active",
      runsQuota: p.credits,
      runsUsed: 0,
      creditBalance: p.credits,
      creditsMigrated: true,
      nextBillingAt: nextBillingDate(),
    },
  });
}

export type SettleResult =
  | { ok: true; duplicate: boolean; kind: string; plan?: string }
  | { ok: false; error: string };

/**
 * Verify a Paystack reference and apply it once.
 * A repeated redirect or webhook sees status=success and does not credit again.
 */
export async function settlePayment(reference: string): Promise<SettleResult> {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return { ok: false, error: "unknown payment" };
  if (payment.status === "success") return { ok: true, duplicate: true, kind: payment.kind };

  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "verify failed" };
  }
  if (tx.status !== "success" || tx.currency !== "NGN" || tx.amount !== payment.amountKobo) {
    await prisma.payment.updateMany({ where: { reference, status: "pending" }, data: { status: "failed" } });
    return { ok: false, error: "payment was not successful" };
  }

  const meta = (payment.meta ?? {}) as { plan?: string; credits?: number };
  const plan = meta.plan && isPlanKey(meta.plan) ? meta.plan : null;
  const topupCredits = Number(meta.credits ?? CREDIT_TOPUP.credits);

  const applied = await prisma.$transaction(async (db) => {
    const changed = await db.payment.updateMany({
      where: { reference, status: { not: "success" } },
      data: { status: "success" },
    });
    if (changed.count !== 1) return false;
    if (tx.authorization?.reusable && tx.authorization.authorization_code) {
      await db.user.update({
        where: { id: payment.userId },
        data: {
          cardAuthCode: tx.authorization.authorization_code,
          cardLast4: tx.authorization.last4,
          cardBank: tx.authorization.bank,
          paystackCustomer: tx.customer.customer_code,
        },
      });
    }
    if (payment.kind === "topup") {
      await db.user.update({
        where: { id: payment.userId },
        data: { topupBalance: { increment: topupCredits }, creditsMigrated: true },
      });
    } else if ((payment.kind === "plan" || payment.kind === "recurring") && plan) {
      const p = PLANS[plan];
      await db.user.update({
        where: { id: payment.userId },
        data: {
          plan,
          planStatus: "active",
          runsQuota: p.credits,
          runsUsed: 0,
          creditBalance: p.credits,
          creditsMigrated: true,
          nextBillingAt: nextBillingDate(),
        },
      });
    }
    return true;
  });

  return { ok: true, duplicate: !applied, kind: payment.kind, plan: plan ?? undefined };
}
