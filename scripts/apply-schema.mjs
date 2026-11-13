// Applies prisma/schema.prisma to the database during deploy.
//
// PR #33's diff is additive only: creditBalance, topupBalance, and
// creditsMigrated on "user" (each with a default), plus usage_ledger,
// active_run, and spend_alert. It does not change an existing column type
// and it does not add a unique constraint, so it does not need
// --accept-data-loss. That flag stays off. Passing it would let Prisma drop
// any live column this schema no longer lists.
//
// `prisma db push` still exits non-zero on a non-interactive build when the
// engine reports any warning or a step it will not run, and this script
// continues so the app can ship. The generated client then SELECTs every
// user column, including creditBalance, on sign-in. Postgres rejects that
// query, and better-auth turns a "column does not exist" error into an
// empty HTTP 500. The credit SQL runs first and adds those objects with
// IF NOT EXISTS, so a later push is a no-op when that was the only drift.
//
// Skips when DATABASE_URL is unset (local typecheck, CI without a database).

import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[schema] DATABASE_URL is not set. Skipping prisma db push.");
  console.log("[schema] On Vercel, set DATABASE_URL for Production, available at build time, then redeploy.");
  process.exit(0);
}

const env = { ...process.env };
if (!env.DATABASE_URL_UNPOOLED) {
  console.log("[schema] DATABASE_URL_UNPOOLED is unset. Using DATABASE_URL for DDL.");
  env.DATABASE_URL_UNPOOLED = env.DATABASE_URL;
}

const credits = spawnSync(process.execPath, ["scripts/apply-credit-schema.mjs"], { stdio: "inherit", env });
if (credits.status !== 0) {
  console.error("[schema] Credit SQL did not apply. Sign-in still selects creditBalance and will fail until it does.");
}

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { stdio: "inherit", env }
);

if (result.status !== 0) {
  console.error("[schema] prisma db push failed. Credit columns were already applied by scripts/apply-credit-schema.mjs when that step succeeded.");
  console.error("[schema] db push was not retried with --accept-data-loss, because that flag can drop columns.");
}

const agentic = spawnSync(process.execPath, ["scripts/apply-agentic-schema.mjs"], { stdio: "inherit", env });
if (agentic.status !== 0) {
  console.error("[schema] Agentic SQL did not apply. /agentic-chat still runs with in-memory checkpoints.");
}

console.log("[schema] Database schema step finished.");
