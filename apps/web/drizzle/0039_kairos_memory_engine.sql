-- Kairos memory engine + thinking queue (docs/kairos/32-memory-engine.md).
-- Additive only. Applied by scripts/apply-memory-engine-migration.mjs because
-- the drizzle journal is frozen; declared in schema.ts for drift checks.

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "standing" real;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "standing_at" timestamp;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "use_count" integer DEFAULT 0 NOT NULL;
CREATE INDEX IF NOT EXISTS "memories_standing_idx" ON "memories" ("user_id", "standing");

CREATE TABLE IF NOT EXISTS "memory_ops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "run_id" uuid,
  "memory_id" uuid,
  "step" varchar(30) NOT NULL,
  "op" varchar(30) NOT NULL,
  "before" jsonb,
  "after" jsonb,
  "reason" text NOT NULL,
  "reverted_at" timestamp,
  "reverted_by_op_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "memory_ops_user_idx" ON "memory_ops" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "memory_ops_memory_idx" ON "memory_ops" ("memory_id");
CREATE INDEX IF NOT EXISTS "memory_ops_run_idx" ON "memory_ops" ("run_id");

CREATE TABLE IF NOT EXISTS "thinking_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" varchar(40) NOT NULL,
  "dominion_id" uuid REFERENCES "dominions"("id") ON DELETE set null,
  "external_key" varchar(200) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "input" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output" jsonb,
  "claimed_by" varchar(20),
  "claim_token" uuid,
  "claimed_at" timestamp,
  "deadline_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "attempts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "thinking_jobs_user_key_idx" ON "thinking_jobs" ("user_id", "external_key");
CREATE INDEX IF NOT EXISTS "thinking_jobs_status_idx" ON "thinking_jobs" ("user_id", "status", "deadline_at");
