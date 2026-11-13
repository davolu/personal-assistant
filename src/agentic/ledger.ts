/** Prisma stores EffectLedger.userId as "userId". Older SQL used user_id. Use whichever column exists. */

const OWNERS = ["userId", "user_id"] as const;

export function ledgerOwnerSql(column: string): string {
  if (column === "userId") return '"userId"';
  if (column === "user_id") return "user_id";
  throw new Error("effect_ledger has no owner column");
}

export function pickLedgerOwner(columns: string[]): string {
  const names = new Set(columns);
  for (const column of OWNERS) {
    if (names.has(column)) return ledgerOwnerSql(column);
  }
  return ledgerOwnerSql("userId");
}

export function effectLedgerSql(ownerSql: string): { get: string; put: string } {
  return {
    get: `SELECT result FROM effect_ledger WHERE key = $1 AND ${ownerSql} = $2`,
    put: `INSERT INTO effect_ledger (key, ${ownerSql}, result) VALUES ($1, $2, $3::jsonb) ON CONFLICT (key) DO NOTHING`,
  };
}

export function ledgerResultText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (typeof result === "object" && result && "content" in result) return String((result as { content: unknown }).content ?? "");
  return JSON.stringify(result);
}
