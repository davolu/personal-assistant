import { getSession } from "@/lib/session";
import { connectionSnapshot } from "@/lib/connection-status";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const app = new URL(req.url).searchParams.get("app")?.trim() ?? "";
  const snapshot = await connectionSnapshot(session.user.id, app || undefined);
  return Response.json({ app, connected: snapshot.connected, active: snapshot.active });
}
