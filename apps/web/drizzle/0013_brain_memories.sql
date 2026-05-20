-- Brain Phase 1 — user-scoped memory substrate.
-- Spec: docs/brain/01-schema.md
--
-- Idempotent: safe to run after `db:push` has already created the bare table
-- (everything except the `fts` tsvector and the GIN indexes), and also safe
-- to run as a fresh prod migration.

CREATE TABLE IF NOT EXISTS "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"realm_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"title" varchar(255) NOT NULL,
	"body_md" text NOT NULL,
	"summary" text,
	"type" varchar(30) DEFAULT 'note' NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_realm_id_workspace_groups_id_fk" FOREIGN KEY ("realm_id") REFERENCES "public"."workspace_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "memories" ADD CONSTRAINT "memories_task_id_board_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."board_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint

-- Generated tsvector for weighted full-text search (title > summary > body).
-- Postgres maintains this automatically on every insert/update.
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "fts" tsvector
	GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
		setweight(to_tsvector('english', coalesce("body_md", '')), 'C')
	) STORED;

--> statement-breakpoint

-- Btree indexes (idempotent — drizzle-kit may have already created equivalents from schema.ts).
-- Kept as full indexes (no partial WHERE) to match exactly what drizzle-kit emits.
CREATE INDEX IF NOT EXISTS "memories_user_idx"    ON "memories" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "memories_realm_idx"   ON "memories" ("realm_id");
CREATE INDEX IF NOT EXISTS "memories_project_idx" ON "memories" ("project_id");
CREATE INDEX IF NOT EXISTS "memories_task_idx"    ON "memories" ("task_id");
CREATE INDEX IF NOT EXISTS "memories_type_idx"    ON "memories" ("user_id", "type");

--> statement-breakpoint

-- GIN indexes for FTS and tag containment queries.
CREATE INDEX IF NOT EXISTS "memories_fts_idx"  ON "memories" USING GIN ("fts");
CREATE INDEX IF NOT EXISTS "memories_tags_idx" ON "memories" USING GIN ("tags" jsonb_path_ops);
