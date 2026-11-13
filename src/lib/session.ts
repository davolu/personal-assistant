import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { databaseProblem } from "@/lib/db-error";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * A missing credit column must not look like a signed-out user.
 * Pages that redirect when the session is null use this and show a data error instead.
 */
export async function readPageSession(): Promise<
  { ok: true; session: Awaited<ReturnType<typeof getSession>> } | { ok: false; detail: string }
> {
  try {
    return { ok: true, session: await getSession() };
  } catch (error) {
    const detail = databaseProblem(error);
    if (!detail) throw error;
    const message = error instanceof Error ? error.message : "database error";
    console.error("[session]", message.slice(0, 300));
    return { ok: false, detail };
  }
}
