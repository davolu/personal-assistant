// Applies prisma/sql/credits.sql. Skips when DATABASE_URL is unset.
// Runs on every build, before prisma db push, the same way as apply-agentic-schema.mjs.
// The statements are idempotent. A failed push must not leave sign-in selecting
// columns that Postgres does not have yet.

import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[credits] DATABASE_URL is not set. Skipping credit schema SQL.");
  process.exit(0);
}

const sql = readFileSync(new URL("../prisma/sql/credits.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  console.log("[credits] Credit columns, usage tables, and the emailVerified backfill are ready.");
} catch (error) {
  console.error("[credits] SQL was not applied.", error instanceof Error ? error.message : error);
  process.exit(0);
} finally {
  await client.end().catch(() => undefined);
}
