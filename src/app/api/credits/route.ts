import { getSession } from "@/lib/session";
import { formatCredits, isLowBalance, planKeyOf } from "@/lib/credits";
import { PLANS } from "@/lib/site";
import { balanceOf, ensureUserCredits, recentUsage } from "@/lib/usage-store";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const user = await ensureUserCredits(session.user.id);
  if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
  const plan = planKeyOf(user.plan);
  const allowance = PLANS[plan].credits;
  const planBalance = Number(user.creditBalance);
  const topup = Number(user.topupBalance);
  const remaining = balanceOf(user);
  const usage = await recentUsage(session.user.id);
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
