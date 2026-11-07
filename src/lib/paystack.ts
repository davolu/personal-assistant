const BASE = "https://api.paystack.co";

function headers() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set — add it to .env.local");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

type PaystackResponse<T> = { status: boolean; message: string; data: T };

export async function initializeTransaction(params: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}) {
  const res = await fetch(`${BASE}/transaction/initialize`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      currency: "NGN",
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });
  const json = (await res.json()) as PaystackResponse<{ authorization_url: string; reference: string }>;
  if (!json.status) throw new Error(`Paystack initialize failed: ${json.message}`);
  return json.data;
}

export type VerifiedTransaction = {
  status: string; // "success" | ...
  reference: string;
  amount: number;
  currency: string;
  customer: { customer_code: string; email: string };
  authorization?: {
    authorization_code: string;
    last4: string;
    bank: string;
    reusable: boolean;
  };
  metadata?: Record<string, unknown>;
};

export async function verifyTransaction(reference: string) {
  const res = await fetch(`${BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(),
    cache: "no-store",
  });
  const json = (await res.json()) as PaystackResponse<VerifiedTransaction>;
  if (!json.status) throw new Error(`Paystack verify failed: ${json.message}`);
  return json.data;
}

export async function chargeAuthorization(params: {
  email: string;
  amountKobo: number;
  authorizationCode: string;
  reference: string;
  metadata?: Record<string, unknown>;
}) {
  const res = await fetch(`${BASE}/transaction/charge_authorization`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      currency: "NGN",
      authorization_code: params.authorizationCode,
      reference: params.reference,
      metadata: params.metadata,
    }),
  });
  const json = (await res.json()) as PaystackResponse<{ status: string; reference: string }>;
  if (!json.status) throw new Error(`Paystack charge failed: ${json.message}`);
  return json.data;
}
