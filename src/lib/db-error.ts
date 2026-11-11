/**
 * Turns a missing table, missing column, or unreachable database into a sentence
 * a page can show. Anything else returns null so the caller can rethrow it.
 */
export function databaseProblem(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "P2021" || code === "P2022") {
    return "The database is missing a table or column this deploy expects. Apply the schema with prisma db push, then reload.";
  }
  if (code === "P1001" || code === "P1000" || code === "P1017") {
    return "The database could not be reached. Check DATABASE_URL on the host that renders this page.";
  }
  if (code === "P2025") {
    return "That record is not in the database.";
  }
  const message = error instanceof Error ? error.message : "";
  if (/Environment variable not found: DATABASE_URL/i.test(message)) {
    return "DATABASE_URL is not set for this deployment.";
  }
  if (/column [`']?.+[`']? does not exist/i.test(message) || /relation [`']?.+[`']? does not exist/i.test(message)) {
    return "The database is missing a table or column this deploy expects. Apply the schema with prisma db push, then reload.";
  }
  return null;
}

export async function guardQuery<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; detail: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const detail = databaseProblem(error);
    if (!detail) throw error;
    const message = error instanceof Error ? error.message : "database error";
    console.error("[db]", message.slice(0, 300));
    return { ok: false, detail };
  }
}

/** Columns the existing product pages need. Omits `scopes`, which older databases do not have yet. */
export const connectionListSelect = {
  id: true,
  toolkit: true,
  status: true,
  composioSlug: true,
  composioAccountId: true,
} as const;
