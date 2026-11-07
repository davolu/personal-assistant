import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTransaction } from "@/lib/paystack";
import { applyPlan, isPlanKey } from "@/lib/billing";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Paystack redirects the customer here after payment: ?reference=...&trxref=...
export async function GET(req: NextRequest) {
  const reference =
    req.nextUrl.searchParams.get("reference") || req.nextUrl.searchParams.get("trxref");
  if (!reference) return NextResponse.redirect(new URL("/pricing", appUrl()));

  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return NextResponse.redirect(new URL("/pricing", appUrl()));

  const meta = (payment.meta ?? {}) as { plan?: string };

  try {
    const tx = await verifyTransaction(reference);

    if (tx.status !== "success") {
      await prisma.payment.update({ where: { reference }, data: { status: "failed" } });
      return NextResponse.redirect(new URL(`/pricing?error=payment`, appUrl()));
    }

    // Idempotent: a repeat visit just lands on the dashboard.
    if (payment.status !== "success") {
      await prisma.payment.update({ where: { reference }, data: { status: "success" } });

      if (tx.authorization?.reusable) {
        await prisma.user.update({
          where: { id: payment.userId },
          data: {
            cardAuthCode: tx.authorization.authorization_code,
            cardLast4: tx.authorization.last4,
            cardBank: tx.authorization.bank,
            paystackCustomer: tx.customer.customer_code,
          },
        });
      }

      if (meta.plan && isPlanKey(meta.plan)) {
        await applyPlan(payment.userId, meta.plan);
      }
    }

    return NextResponse.redirect(new URL(`/dashboard?plan=${meta.plan ?? ""}`, appUrl()));
  } catch (err) {
    console.error("paystack verify error", err);
    return NextResponse.redirect(new URL(`/pricing?error=payment`, appUrl()));
  }
}
