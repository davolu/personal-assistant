import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { chargeAuthorization } from "@/lib/paystack";
import { usdToKobo, isPlanKey, nextBillingDate, settlePayment } from "@/lib/billing";
import { PLANS } from "@/lib/site";
import { migratedPlanCredits } from "@/lib/credits";

// Monthly billing + run-quota resets. Call daily from a scheduler (e.g. Vercel Cron):
//   GET /api/cron/billing  with header  Authorization: Bearer <BILLING_CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.BILLING_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const unmigrated = await prisma.user.findMany({
    where: { creditsMigrated: false },
    select: { id: true, plan: true, runsQuota: true, runsUsed: true, nextBillingAt: true },
    take: 200,
  });
  for (const user of unmigrated) {
    const plan = isPlanKey(user.plan) ? user.plan : "free";
    await prisma.user.update({
      where: { id: user.id },
      data: {
        creditBalance: migratedPlanCredits(user),
        creditsMigrated: true,
        runsQuota: PLANS[plan].credits,
        nextBillingAt: user.nextBillingAt ?? nextBillingDate(),
      },
    });
  }

  // 1. Free users whose cycle is due: reset monthly credits (no charge). Top-ups stay.
  const freeReset = await prisma.user.updateMany({
    where: { plan: "free", creditsMigrated: true, nextBillingAt: { lte: now } },
    data: { runsUsed: 0, creditBalance: PLANS.free.credits, runsQuota: PLANS.free.credits, nextBillingAt: nextBillingDate() },
  });

  // 2. Paid users due for billing.
  const due = await prisma.user.findMany({
    where: {
      plan: { not: "free" },
      planStatus: "active",
      nextBillingAt: { lte: now },
      cardAuthCode: { not: null },
    },
    take: 50,
  });

  const results: { userId: string; ok: boolean; detail: string }[] = [];

  for (const user of due) {
    if (!isPlanKey(user.plan) || user.plan === "free") continue;
    const p = PLANS[user.plan];
    try {
      const amountKobo = usdToKobo(p.price);
      const reference = `agyr_${randomBytes(10).toString("hex")}`;

      await prisma.payment.create({
        data: {
          userId: user.id,
          reference,
          amountKobo,
          status: "pending",
          kind: "recurring",
          description: `${p.label} plan renewal — ${p.credits.toLocaleString()} credits`,
          meta: { plan: user.plan },
        },
      });

      const charge = await chargeAuthorization({
        email: user.email,
        amountKobo,
        authorizationCode: user.cardAuthCode!,
        reference,
        metadata: { userId: user.id, plan: user.plan },
      });

      if (charge.status !== "success") {
        await prisma.payment.update({ where: { reference }, data: { status: "failed" } });
        await prisma.user.update({ where: { id: user.id }, data: { planStatus: "past_due" } });
        results.push({ userId: user.id, ok: false, detail: charge.status });
        continue;
      }
      const settled = await settlePayment(reference);
      results.push({ userId: user.id, ok: settled.ok, detail: settled.ok ? "success" : settled.error });
    } catch (err) {
      await prisma.user.update({ where: { id: user.id }, data: { planStatus: "past_due" } });
      results.push({ userId: user.id, ok: false, detail: String(err) });
    }
  }

  return NextResponse.json({ freeResets: freeReset.count, billed: results.length, results });
}
