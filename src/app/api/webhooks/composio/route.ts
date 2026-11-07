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
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  return sig.split(" ").some((part) => {
    const candidate = part.includes(",") ? part.split(",")[1] : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
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
