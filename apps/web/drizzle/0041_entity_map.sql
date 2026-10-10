-- Total Recall step 2a: the entity map, no LLM (Vorath decision c695afe6).
-- Additive and idempotent. Applied with `npm run db:apply -- drizzle/0041_entity_map.sql`
-- because the drizzle journal is frozen; declared in schema.ts for drift checks.

CREATE TABLE IF NOT EXISTS "entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" varchar(20) NOT NULL,
  "name" varchar(200) NOT NULL,
  "norm_name" varchar(200) NOT NULL,
  "ref_kind" varchar(20),
  "ref_id" text,
  "source" varchar(20) DEFAULT 'seed' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "merged_into_id" uuid REFERENCES "entities"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "entities_kind_check" CHECK ("kind" IN ('person', 'project', 'repo', 'app', 'tool', 'dominion', 'concept')),
  CONSTRAINT "entities_ref_kind_check" CHECK ("ref_kind" IS NULL OR "ref_kind" IN ('dominion', 'project', 'hangar_repo', 'dominion_repo', 'label', 'member', 'virtual_member')),
  CONSTRAINT "entities_source_check" CHECK ("source" IN ('seed', 'llm', 'manual')),
  CONSTRAINT "entities_status_check" CHECK ("status" IN ('active', 'merged'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "entities_user_kind_norm_uniq" ON "entities" ("user_id", "kind", "norm_name");

CREATE TABLE IF NOT EXISTS "entity_aliases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "alias" varchar(200) NOT NULL,
  "alias_norm" varchar(200) NOT NULL,
  "source" varchar(20) DEFAULT 'seed' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "entity_aliases_entity_norm_uniq" ON "entity_aliases" ("entity_id", "alias_norm");
CREATE INDEX IF NOT EXISTS "entity_aliases_user_norm_idx" ON "entity_aliases" ("user_id", "alias_norm");

CREATE TABLE IF NOT EXISTS "entity_mentions" (
  "entity_id" uuid NOT NULL REFERENCES "entities"("id") ON DELETE cascade,
  "memory_id" uuid NOT NULL REFERENCES "memories"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source" varchar(20) NOT NULL,
  "confidence" real DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "entity_mentions_pk" PRIMARY KEY ("entity_id", "memory_id"),
  CONSTRAINT "entity_mentions_source_check" CHECK ("source" IN ('fk', 'dict', 'llm'))
);
CREATE INDEX IF NOT EXISTS "entity_mentions_memory_idx" ON "entity_mentions" ("memory_id");
CREATE INDEX IF NOT EXISTS "entity_mentions_user_entity_idx" ON "entity_mentions" ("user_id", "entity_id");

CREATE TABLE IF NOT EXISTS "entity_scans" (
  "memory_id" uuid PRIMARY KEY NOT NULL REFERENCES "memories"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "scanned_at" timestamp DEFAULT now() NOT NULL,
  "method" varchar(20) NOT NULL,
  "model" varchar(120),
  CONSTRAINT "entity_scans_method_check" CHECK ("method" IN ('dict', 'llm'))
);
CREATE INDEX IF NOT EXISTS "entity_scans_user_idx" ON "entity_scans" ("user_id", "scanned_at");
