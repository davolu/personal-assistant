import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isPlanKey, usdToKobo } from "@/lib/billing";
import { PLANS } from "@/lib/site";
import { initializeTransaction } from "@/lib/paystack";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Subscribe to (or upgrade) a run-based plan.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/signin?next=/pricing", appUrl()), 303);

  const form = await req.formData();
  const plan = String(form.get("plan") || "");
  if (!isPlanKey(plan) || plan === "free") {
    return NextResponse.redirect(new URL("/pricing", appUrl()), 303);
  }

  const p = PLANS[plan];
  const reference = `agy_${randomBytes(10).toString("hex")}`;
  await prisma.payment.create({
    data: {
      userId: session.user.id,
      reference,
      amountKobo: usdToKobo(p.price),
      status: "pending",
      kind: "plan",
      description: `${p.label} plan — ${p.runs.toLocaleString()} runs/month`,
      meta: { plan },
    },
  });

  try {
    const tx = await initializeTransaction({
      email: session.user.email,
      amountKobo: usdToKobo(p.price),
      reference,
      callbackUrl: `${appUrl()}/api/paystack/verify`,
      metadata: { userId: session.user.id, plan },
    });
    return NextResponse.redirect(tx.authorization_url, 303);
  } catch (err) {
    console.error("checkout error", err);
    await prisma.payment.update({ where: { reference }, data: { status: "failed" } });
    return NextResponse.redirect(new URL(`/pricing?error=payment`, appUrl()), 303);
  }
}
