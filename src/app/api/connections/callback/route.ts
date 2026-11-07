import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getConnectedAccountStatus } from "@/lib/composio";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Composio redirects the user here after the OAuth dance completes.
export async function GET(req: NextRequest) {
  const toolkit = req.nextUrl.searchParams.get("toolkit") || "";
  const agent = req.nextUrl.searchParams.get("agent") || "";
  const dest = agent ? `/connect/${agent}` : "/dashboard";

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/signin", appUrl()));

  const conn = await prisma.connection.findUnique({
    where: { userId_toolkit: { userId: session.user.id, toolkit } },
  });
  if (!conn?.composioAccountId) {
    return NextResponse.redirect(new URL(`${dest}?failed=${encodeURIComponent(toolkit)}`, appUrl()));
  }

  try {
    const status = await getConnectedAccountStatus(conn.composioAccountId);
    const ok = status.toUpperCase() === "ACTIVE";
    await prisma.connection.update({
      where: { id: conn.id },
      data: { status: ok ? "active" : "failed" },
    });
    return NextResponse.redirect(
      new URL(`${dest}?${ok ? "connected" : "failed"}=${encodeURIComponent(toolkit)}`, appUrl())
    );
  } catch (err) {
    console.error("connection callback error", err);
    return NextResponse.redirect(new URL(`${dest}?failed=${encodeURIComponent(toolkit)}`, appUrl()));
  }
}
