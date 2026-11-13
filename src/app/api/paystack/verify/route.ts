import { NextRequest, NextResponse } from "next/server";
import { settlePayment } from "@/lib/billing";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Paystack redirects the customer here after payment: ?reference=...&trxref=...
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") || req.nextUrl.searchParams.get("trxref");
  if (!reference) return NextResponse.redirect(new URL("/pricing", appUrl()));

  const settled = await settlePayment(reference);
  if (!settled.ok) return NextResponse.redirect(new URL("/pricing?error=payment", appUrl()));
  if (settled.kind === "topup") return NextResponse.redirect(new URL("/dashboard?topup=1", appUrl()));
  return NextResponse.redirect(new URL(`/dashboard?plan=${settled.plan ?? ""}`, appUrl()));
}
