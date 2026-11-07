import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { toolkit } = (await req.json().catch(() => ({}))) as { toolkit?: string };
  if (!toolkit) return NextResponse.json({ error: "Missing toolkit" }, { status: 400 });

  const conn = await prisma.connection.findFirst({
    where: { userId: session.user.id, toolkit },
  });
  if (!conn) return NextResponse.json({ error: "Not connected" }, { status: 404 });

  // Revoke on Composio first so the OAuth grant actually dies, not just our row.
  if (conn.composioAccountId) {
    try {
      await fetch(`https://backend.composio.dev/api/v3/connected_accounts/${conn.composioAccountId}`, {
        method: "DELETE",
        headers: { "x-api-key": process.env.COMPOSIO_API_KEY || "" },
      });
    } catch (err) {
      console.error("[disconnect] Composio revoke failed", conn.composioAccountId, err);
    }
  }

  await prisma.connection.delete({ where: { id: conn.id } });
  return NextResponse.json({ ok: true });
}
