import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { chargeAuthorization } from "@/lib/paystack";
import { usdToKobo, isPlanKey } from "@/lib/billing";
import { PLANS } from "@/lib/site";

// Monthly billing + run-quota resets. Call daily from a scheduler (e.g. Vercel Cron):
//   GET /api/cron/billing  with header  Authorization: Bearer <BILLING_CRON_SECRET>
export async function GET(req: NextRequest) {
  const secret = process.env.BILLING_CRON_SECRET || process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nextCycle = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // 1. Free users: reset their monthly run quota (no charge).
  const freeReset = await prisma.user.updateMany({
    where: { plan: "free", OR: [{ nextBillingAt: null }, { nextBillingAt: { lte: now } }] },
    data: { runsUsed: 0, nextBillingAt: nextCycle() },
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
          description: `${p.label} plan renewal — ${p.runs.toLocaleString()} runs`,
        },
      });

      const charge = await chargeAuthorization({
        email: user.email,
        amountKobo,
        authorizationCode: user.cardAuthCode!,
        reference,
      });

      const ok = charge.status === "success";
      await prisma.$transaction([
        prisma.payment.update({ where: { reference }, data: { status: ok ? "success" : "failed" } }),
        prisma.user.update({
          where: { id: user.id },
          data: ok
            ? { runsUsed: 0, runsQuota: p.runs, nextBillingAt: nextCycle() }
            : { planStatus: "past_due" },
        }),
      ]);
      results.push({ userId: user.id, ok, detail: charge.status });
    } catch (err) {
      await prisma.user.update({ where: { id: user.id }, data: { planStatus: "past_due" } });
      results.push({ userId: user.id, ok: false, detail: String(err) });
    }
  }

  return NextResponse.json({ freeResets: freeReset.count, billed: results.length, results });
}
