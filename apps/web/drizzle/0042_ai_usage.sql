-- Wave 0 logging + spend cap: one row per paid-key LLM call (owner's BYOK key).
-- Additive and idempotent. Applied with `npm run db:apply -- drizzle/0042_ai_usage.sql`
-- because the drizzle journal is frozen; declared in schema.ts for drift checks.
-- created_at is written by the app as UTC; the daily cap sums from UTC midnight.

CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "task" varchar(60) NOT NULL,
  "provider_id" varchar(20) NOT NULL,
  "model_id" varchar(120) NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
  "latency_ms" integer NOT NULL,
  "ok" boolean NOT NULL,
  "error" varchar(200),
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_usage_user_created_idx" ON "ai_usage" ("user_id", "created_at");
