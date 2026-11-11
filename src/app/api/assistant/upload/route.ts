import { getSession } from "@/lib/session";
import { saveUpload } from "@/lib/assistant-runtime";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { filename?: string; text?: string };
  const text = String(body.text ?? "");
  if (!text.trim()) return Response.json({ error: "Paste the text of a .txt or .md file. PDF parsing is not enabled yet." }, { status: 400 });
  if (text.length > 100_000) return Response.json({ error: "File is over 100,000 characters" }, { status: 400 });
  const saved = await saveUpload(session.user.id, String(body.filename ?? "notes.txt"), text);
  return Response.json(saved);
}
