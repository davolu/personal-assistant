import { runDueWork } from "@/lib/assistant-runtime";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.BILLING_CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runDueWork(new Date());
  return Response.json({ ok: true, ...result });
}
