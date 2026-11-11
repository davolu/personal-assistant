// Applies prisma/schema.prisma to the database during deploy.
// The project has no migration history, so `db push` is the additive sync:
// it creates the assistant tables and adds connection.scopes without dropping data.
//
// Skips when DATABASE_URL is unset (local typecheck, CI without a database).
// If the push fails, the build continues so the graceful pages can ship.
// The Vercel build log still says the schema was not applied.

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

const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { stdio: "inherit", env }
);

if (result.status !== 0) {
  console.error("[schema] prisma db push failed. Pages that query new columns will show a setup message instead of crashing.");
  console.error("[schema] Apply it yourself: DATABASE_URL=... DATABASE_URL_UNPOOLED=... npx prisma db push");
  process.exit(0);
}

console.log("[schema] Database schema matches prisma/schema.prisma.");
