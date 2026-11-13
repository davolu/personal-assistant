import { prisma } from "@/lib/prisma";
import { PLANS, type PlanKey } from "@/lib/site";

export const NGN_RATE = Number(process.env.NGN_RATE || 1600);
export const usdToKobo = (usd: number) => Math.round(usd * NGN_RATE) * 100;

export function isPlanKey(v: string): v is PlanKey {
  return v in PLANS;
}

/** Apply a paid plan after successful checkout. */
export async function applyPlan(userId: string, plan: PlanKey) {
  const p = PLANS[plan];
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan,
      planStatus: "active",
      runsQuota: p.runs,
      nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}
