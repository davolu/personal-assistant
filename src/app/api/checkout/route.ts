import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isPlanKey, usdToKobo } from "@/lib/billing";
import { CREDIT_TOPUP, PLANS } from "@/lib/site";
import { initializeTransaction } from "@/lib/paystack";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Subscribe to (or upgrade) a run-based plan.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/signin?next=/pricing", appUrl()), 303);

  const form = await req.formData();
  const plan = String(form.get("plan") || "");
  const topup = plan === "topup";
  if (!topup && (!isPlanKey(plan) || plan === "free")) {
    return NextResponse.redirect(new URL("/pricing", appUrl()), 303);
  }

  const price = topup ? CREDIT_TOPUP.price : PLANS[plan as keyof typeof PLANS].price;
  const description = topup
    ? `${CREDIT_TOPUP.credits.toLocaleString()} credits — they do not expire`
    : `${PLANS[plan as keyof typeof PLANS].label} plan — ${PLANS[plan as keyof typeof PLANS].credits.toLocaleString()} credits/month`;
  const reference = `agy_${randomBytes(10).toString("hex")}`;
  await prisma.payment.create({
    data: {
      userId: session.user.id,
      reference,
      amountKobo: usdToKobo(price),
      status: "pending",
      kind: topup ? "topup" : "plan",
      description,
      meta: topup ? { credits: CREDIT_TOPUP.credits } : { plan },
    },
  });

  try {
    const tx = await initializeTransaction({
      email: session.user.email,
      amountKobo: usdToKobo(price),
      reference,
      callbackUrl: `${appUrl()}/api/paystack/verify`,
      metadata: topup ? { userId: session.user.id, credits: CREDIT_TOPUP.credits } : { userId: session.user.id, plan },
    });
    return NextResponse.redirect(tx.authorization_url, 303);
  } catch (err) {
    console.error("checkout error", err);
    await prisma.payment.update({ where: { reference }, data: { status: "failed" } });
    return NextResponse.redirect(new URL(`/pricing?error=payment`, appUrl()), 303);
  }
}
