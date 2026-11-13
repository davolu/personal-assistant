// Applies prisma/sql/agentic.sql. Skips when DATABASE_URL is unset.
// pgvector is optional: the vector columns are added when the extension exists.

import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.log("[agentic] DATABASE_URL is not set. Skipping agentic SQL.");
  process.exit(0);
}

const sql = readFileSync(new URL("../prisma/sql/agentic.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  const extension = await client.query("CREATE EXTENSION IF NOT EXISTS vector").then(
    () => true,
    () => false
  );
  if (extension) {
    await client.query("ALTER TABLE agentic_memory_fact ADD COLUMN IF NOT EXISTS embedding vector(1536)");
    await client.query("ALTER TABLE agentic_episode ADD COLUMN IF NOT EXISTS embedding vector(1536)");
    console.log("[agentic] pgvector columns are ready.");
  } else {
    console.log("[agentic] pgvector is not installed. Facts fall back to keyword search.");
  }
  console.log("[agentic] Agentic tables are ready.");
} catch (error) {
  console.error("[agentic] SQL was not applied.", error instanceof Error ? error.message : error);
  process.exit(0);
} finally {
  await client.end().catch(() => undefined);
}
