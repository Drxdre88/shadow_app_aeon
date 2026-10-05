-- Living Dominions (research/vorath_0510/living_dominions.md). Additive and
-- idempotent. Applied by scripts/apply-living-dominions-migration.mjs because
-- the drizzle journal is frozen; declared in schema.ts for drift checks.

ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "activity_score" real DEFAULT 0 NOT NULL;
ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp;
ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "activity_scored_at" timestamp;
ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "activity" jsonb;
ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "focus_state" varchar(20) DEFAULT 'active' NOT NULL;
ALTER TABLE "dominions" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "dominion_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "dominion_id" uuid NOT NULL REFERENCES "dominions"("id") ON DELETE cascade,
  "kind" varchar(20) NOT NULL,
  "ref" varchar(200) NOT NULL,
  "weight" real DEFAULT 1 NOT NULL,
  "source" varchar(20) DEFAULT 'owner' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "evidence" jsonb,
  "last_signal_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "dominion_members_uniq" ON "dominion_members" ("user_id", "kind", "ref", "dominion_id");
CREATE INDEX IF NOT EXISTS "dominion_members_lookup_idx" ON "dominion_members" ("user_id", "kind", "ref");
CREATE INDEX IF NOT EXISTS "dominion_members_dominion_idx" ON "dominion_members" ("dominion_id");

-- Seed: every repo mapping and every board's Dominion becomes an owner-made,
-- active membership of the Dominion's owner.
INSERT INTO "dominion_members" ("user_id", "dominion_id", "kind", "ref", "source", "status")
SELECT d."user_id", r."dominion_id", 'repo', r."repo_slug", 'owner', 'active'
FROM "dominion_repos" r JOIN "dominions" d ON d."id" = r."dominion_id"
ON CONFLICT DO NOTHING;

INSERT INTO "dominion_members" ("user_id", "dominion_id", "kind", "ref", "source", "status")
SELECT d."user_id", p."dominion_id", 'board', p."id"::text, 'owner', 'active'
FROM "projects" p JOIN "dominions" d ON d."id" = p."dominion_id"
WHERE p."user_id" = d."user_id"
ON CONFLICT DO NOTHING;
