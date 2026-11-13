import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("../../prisma/sql/credits.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

/** Scalar columns PR #33 added. Relation fields are not columns. */
const ADDED: Record<string, { table: string; columns: string[] }> = {
  User: {
    table: "user",
    columns: ["creditBalance", "topupBalance", "creditsMigrated"],
  },
  UsageLedger: {
    table: "usage_ledger",
    columns: ["id", "userId", "runId", "type", "units", "credits", "costUsd", "model", "createdAt"],
  },
  ActiveRun: {
    table: "active_run",
    columns: ["id", "userId", "kind", "startedAt", "expiresAt"],
  },
  SpendAlert: {
    table: "spend_alert",
    columns: ["day", "spentUsd", "notifiedAt"],
  },
};

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `schema is missing model ${name}`);
  return match[1];
}

test("credit SQL names every PR #33 column and mapped table", () => {
  for (const [model, spec] of Object.entries(ADDED)) {
    const block = modelBlock(model);
    assert.match(block, new RegExp(`@@map\\("${spec.table}"\\)`));
    for (const column of spec.columns) {
      assert.match(block, new RegExp(`^\\s+${column}\\s`, "m"), `${model}.${column} left the Prisma schema`);
      assert.match(sql, new RegExp(`"${column}"`), `SQL is missing ${spec.table}.${column}`);
    }
    assert.match(sql, new RegExp(`"${spec.table}"`));
  }
});

test("credit SQL is additive and idempotent", () => {
  assert.match(sql, /ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "creditBalance" DECIMAL\(14,6\) NOT NULL DEFAULT 50/);
  assert.match(sql, /ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "topupBalance" DECIMAL\(14,6\) NOT NULL DEFAULT 0/);
  assert.match(sql, /ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "creditsMigrated" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "usage_ledger"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "active_run"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "spend_alert"/);
  assert.match(sql, /"runId" TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /"units" JSONB NOT NULL/);
  assert.match(sql, /"credits" DECIMAL\(14,6\) NOT NULL DEFAULT 0/);
  assert.match(sql, /"costUsd" DECIMAL\(14,8\) NOT NULL DEFAULT 0/);
  assert.match(sql, /"model" TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /"kind" TEXT NOT NULL/);
  assert.match(sql, /"startedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /"expiresAt" TIMESTAMP\(3\) NOT NULL/);
  assert.match(sql, /"spentUsd" DECIMAL\(14,4\) NOT NULL/);
  assert.match(sql, /"notifiedAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "usage_ledger_userId_createdAt_idx"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "usage_ledger_runId_idx"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "active_run_userId_expiresAt_idx"/);
  assert.match(sql, /CONSTRAINT "usage_ledger_pkey" PRIMARY KEY \("id"\)/);
  assert.match(sql, /CONSTRAINT "active_run_pkey" PRIMARY KEY \("id"\)/);
  assert.match(sql, /CONSTRAINT "spend_alert_pkey" PRIMARY KEY \("day"\)/);
  assert.match(sql, /"usage_ledger_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "user"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/);
  assert.match(sql, /"active_run_userId_fkey" FOREIGN KEY \("userId"\) REFERENCES "user"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/);
  assert.doesNotMatch(sql, /\bDROP\b/i);
  assert.doesNotMatch(sql, /accept-data-loss/);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test("emailVerified backfill runs once for accounts that already exist", () => {
  const marker = "grandfathered-before-credit-verification";
  assert.equal(sql.split(marker).length - 1, 2);
  const updateAt = sql.indexOf('UPDATE "user" SET "emailVerified" = TRUE');
  const guardAt = sql.indexOf(`d.description = '${marker}'`);
  assert.ok(guardAt >= 0 && updateAt > guardAt);
  assert.equal(sql.match(/UPDATE "user" SET "emailVerified"/g)?.length, 1);
  assert.match(sql, /WHERE "emailVerified" = FALSE/);
});
