import { readPageSession } from "@/lib/session";
import { formatCredits, isLowBalance, planKeyOf } from "@/lib/credits";
import { PLANS } from "@/lib/site";
import { databaseProblem } from "@/lib/db-error";
import { balanceOf, ensureUserCredits, recentUsage } from "@/lib/usage-store";

export async function GET() {
  const sessionResult = await readPageSession();
  if (!sessionResult.ok) return Response.json({ error: sessionResult.detail }, { status: 503 });
  const session = sessionResult.session;
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  let user: Awaited<ReturnType<typeof ensureUserCredits>>;
  try {
    user = await ensureUserCredits(session.user.id);
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
  if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
  const plan = planKeyOf(user.plan);
  const allowance = PLANS[plan].credits;
  const planBalance = Number(user.creditBalance);
  const topup = Number(user.topupBalance);
  const remaining = balanceOf(user);
  let usage: Awaited<ReturnType<typeof recentUsage>>;
  try {
    usage = await recentUsage(session.user.id);
  } catch (error) {
    const detail = databaseProblem(error);
    if (detail) return Response.json({ error: detail }, { status: 503 });
    throw error;
  }
  return Response.json({
    plan,
    planBalance,
    topup,
    remaining,
    allowance,
    low: isLowBalance(remaining, allowance),
    label: `${formatCredits(remaining)} credits`,
    usage,
  });
}
