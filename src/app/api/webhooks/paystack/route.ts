import { createHmac, timingSafeEqual } from "node:crypto";
import { settlePayment } from "@/lib/billing";

// Paystack charge.success. The redirect verify route calls the same idempotent settle.
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!validSignature(raw, signature)) return Response.json({ error: "invalid signature" }, { status: 401 });

  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(raw) as { event?: string; data?: { reference?: string } };
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (event.event === "charge.success" && event.data?.reference) {
    const settled = await settlePayment(event.data.reference);
    if (!settled.ok) console.error("[paystack]", settled.error);
  }
  return Response.json({ ok: true });
}

function validSignature(raw: string, signature: string | null): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signature) return false;
  const digest = createHmac("sha512", key).update(raw).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
