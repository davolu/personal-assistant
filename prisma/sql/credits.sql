-- Additive credit schema from PR #33. Idempotent: safe on every build.
-- Table and column names match prisma/schema.prisma (@@map and field names).
-- Types match `prisma migrate diff` from the pre-#33 schema:
--   ALTER "user" add creditBalance / topupBalance / creditsMigrated (all with defaults)
--   CREATE usage_ledger, active_run, spend_alert
--   indexes and ON DELETE CASCADE / ON UPDATE CASCADE foreign keys
-- No existing column changes type, and no new unique constraint is added.
-- Existing rows keep their data. New user columns use defaults, so Postgres
-- fills them without a table rewrite that drops anything.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "creditBalance" DECIMAL(14,6) NOT NULL DEFAULT 50;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "topupBalance" DECIMAL(14,6) NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "creditsMigrated" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "usage_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "credits" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(14,8) NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "active_run" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "spend_alert" (
    "day" TEXT NOT NULL,
    "spentUsd" DECIMAL(14,4) NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_alert_pkey" PRIMARY KEY ("day")
);

CREATE INDEX IF NOT EXISTS "usage_ledger_userId_createdAt_idx" ON "usage_ledger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "usage_ledger_runId_idx" ON "usage_ledger"("runId");
CREATE INDEX IF NOT EXISTS "active_run_userId_expiresAt_idx" ON "active_run"("userId", "expiresAt");

DO $$
BEGIN
  ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "active_run" ADD CONSTRAINT "active_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- One-time: accounts that already existed when verification started gating
-- free credits are treated as verified. Later builds see the column comment
-- and leave new unverified email signups alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_description d
    JOIN pg_class c ON c.oid = d.objoid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
    WHERE n.nspname = 'public'
      AND c.relname = 'user'
      AND a.attname = 'emailVerified'
      AND d.description = 'grandfathered-before-credit-verification'
  ) THEN
    UPDATE "user" SET "emailVerified" = TRUE WHERE "emailVerified" = FALSE;
    COMMENT ON COLUMN "user"."emailVerified" IS 'grandfathered-before-credit-verification';
  END IF;
END $$;
