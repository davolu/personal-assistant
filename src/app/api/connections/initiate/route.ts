import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { toolkitComposioSlug, SUPPORTED_TOOLKITS } from "@/lib/toolkits";
import { ensureAuthConfig, createConnectLink } from "@/lib/composio";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/signin", appUrl()), 303);

  const form = await req.formData();
  const toolkit = String(form.get("toolkit") || "");
  const agent = String(form.get("agent") || "");
  if (!SUPPORTED_TOOLKITS.includes(toolkit)) {
    return NextResponse.redirect(new URL(`/connect/${agent}?failed=${encodeURIComponent(toolkit)}`, appUrl()), 303);
  }

  const composioSlug = toolkitComposioSlug(toolkit);
  try {
    const authConfigId = await ensureAuthConfig(composioSlug);
    const callback = `${appUrl()}/api/connections/callback?toolkit=${encodeURIComponent(toolkit)}&agent=${encodeURIComponent(agent)}`;
    const link = await createConnectLink({
      authConfigId,
      userId: session.user.id,
      callbackUrl: callback,
    });

    await prisma.connection.upsert({
      where: { userId_toolkit: { userId: session.user.id, toolkit } },
      update: { status: "pending", composioAccountId: link.connectedAccountId, composioSlug },
      create: {
        userId: session.user.id,
        toolkit,
        composioSlug,
        status: "pending",
        composioAccountId: link.connectedAccountId,
      },
    });

    return NextResponse.redirect(link.redirectUrl, 303);
  } catch (err) {
    console.error("connection initiate error", err);
    return NextResponse.redirect(
      new URL(`/connect/${agent}?failed=${encodeURIComponent(toolkit)}`, appUrl()),
      303
    );
  }
}
