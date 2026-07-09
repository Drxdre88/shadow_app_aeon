-- Bi-temporal valid-time for Kairos memories.
--
-- `superseded_at` (migration 0024) is TRANSACTION time — when we *learned* a
-- belief was replaced. These columns add VALID time — when the claim was true
-- in the world — so learn-order and truth-order stop being conflated:
--   * a late memory about a past truth can't override the current belief, and
--   * a fact can expire (invalid_at) without needing a superseding successor.
--
-- Additive + nullable-safe. Hand-written — the Drizzle journal is frozen at
-- 0010, never run db:generate. See project_drizzle_migration_journal_abandoned.
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "valid_at" timestamp;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "invalid_at" timestamp;

-- Set the DEFAULT before backfilling. This is a metadata-only change (no table
-- rewrite — unlike ADD COLUMN ... DEFAULT now(), which would stamp every row
-- with the migration's run-time instead of created_at). Crucially it means any
-- row inserted by the still-running pre-deploy app *during* this migration
-- already gets now(), closing the NULL race that would otherwise make the
-- SET NOT NULL below fail.
ALTER TABLE "memories" ALTER COLUMN "valid_at" SET DEFAULT now();

-- Backfill the existing corpus to creation time (best-available truth-start);
-- invalid_at stays NULL (no historical expiry is known).
UPDATE "memories" SET "valid_at" = "created_at" WHERE "valid_at" IS NULL;

ALTER TABLE "memories" ALTER COLUMN "valid_at" SET NOT NULL;
