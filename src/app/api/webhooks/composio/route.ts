import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { executeRun } from "@/lib/runner";
import { toolkitForTriggerSlug, agentToolkits } from "@/lib/triggers";

export const maxDuration = 300;

// Composio signs webhooks per the Standard Webhooks spec:
// HMAC-SHA256 of "<id>.<timestamp>.<body>" with the whsec_ secret, base64.
function verifySignature(raw: string, req: NextRequest): boolean {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[composio-webhook] COMPOSIO_WEBHOOK_SECRET not set — accepting unverified webhook");
    return true;
  }
  const id = req.headers.get("webhook-id") || "";
  const ts = req.headers.get("webhook-timestamp") || "";
  const sig = req.headers.get("webhook-signature") || "";
  // Composio secrets appear as raw hex (no whsec_ prefix); Standard Webhooks
  // uses base64. Accept a signature matching any plausible key encoding.
  const secretStr = secret.replace(/^whsec_/, "");
  const keys: Buffer[] = [Buffer.from(secretStr, "utf8")];
  if (/^[0-9a-f]+$/i.test(secretStr) && secretStr.length % 2 === 0) {
    keys.push(Buffer.from(secretStr, "hex"));
  }
  try {
    const b64 = Buffer.from(secretStr, "base64");
    if (b64.length > 0) keys.push(b64);
  } catch {
    /* not base64 */
  }
  const payload = `${id}.${ts}.${raw}`;
  const expectations = keys.flatMap((key) => {
    const mac = crypto.createHmac("sha256", key).update(payload);
    const d = mac.digest();
    return [d.toString("base64"), d.toString("hex")];
  });
  return sig.split(" ").some((part) => {
    const candidate = part.includes(",") ? part.split(",").pop()! : part;
    return expectations.some((exp) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(exp));
      } catch {
        return false;
      }
    });
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Idempotency (Ch53): redelivery of the same event must be a no-op, or a
  // retried webhook double-runs agents (and double-spends the user's runs).
  const eventId =
    req.headers.get("webhook-id") || crypto.createHash("sha256").update(raw).digest("hex");
  try {
    await prisma.webhookEvent.create({ data: { id: eventId.slice(0, 120) } });
  } catch {
    return NextResponse.json({ ok: true, skipped: "duplicate delivery" });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Payload shapes vary slightly across trigger types — read defensively.
  const data = (body.data ?? body) as Record<string, unknown>;
  const triggerSlug = String(
    data.trigger_slug ?? data.triggerSlug ?? body.type ?? ""
  );
  const accountId = String(
    data.connection_nano_id ?? data.connected_account_id ?? data.connectedAccountId ?? ""
  );
  const composioUserId = String(data.user_id ?? data.userId ?? "");

  const toolkit = toolkitForTriggerSlug(triggerSlug);
  if (!toolkit) return NextResponse.json({ ok: true, skipped: "unmapped trigger" });

  // Our Composio user_id IS our app user id; fall back to the connection lookup.
  let userId = composioUserId;
  if (!userId && accountId) {
    const conn = await prisma.connection.findFirst({
      where: { composioAccountId: accountId },
      select: { userId: true },
    });
    userId = conn?.userId ?? "";
  }
  if (!userId) return NextResponse.json({ ok: true, skipped: "no matching user" });

  const candidates = await prisma.hiredAgent.findMany({
    where: { userId, schedule: "event", status: "active" },
    include: { user: { select: { runsUsed: true, runsQuota: true } } },
  });

  const matched: string[] = [];
  for (const agent of candidates) {
    if (agent.user.runsUsed >= agent.user.runsQuota) continue;
    const toolkits = await agentToolkits(agent);
    if (toolkits.includes(toolkit)) matched.push(agent.id);
  }

  // Acknowledge fast; run the agents after the response is sent.
  const eventContext = JSON.stringify(data).slice(0, 4000);
  after(async () => {
    for (const agentId of matched) {
      try {
        await executeRun(agentId, "event", undefined, 1, eventContext);
      } catch (err) {
        console.error("[composio-webhook] event run failed", agentId, err);
      }
    }
  });

  return NextResponse.json({ ok: true, toolkit, matched: matched.length });
}
