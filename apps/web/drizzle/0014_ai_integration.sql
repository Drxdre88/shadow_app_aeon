-- Brain Phase C-0 — admin-gated BYOK AI credentials substrate.
-- Spec: docs/brain/09-ai-integration-handoff.md
--
-- Idempotent: safe to run after `db:push` has already created the bare tables,
-- and also safe to run as a fresh prod migration.

CREATE TABLE IF NOT EXISTS "user_ai_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"label" varchar(100) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_hint" varchar(16),
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "user_ai_credentials"
		ADD CONSTRAINT "user_ai_credentials_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_creds_user_provider_active"
	ON "user_ai_credentials" USING btree ("user_id","provider")
	WHERE revoked_at IS NULL;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_ai_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cheap_provider_id" varchar(32) DEFAULT 'anthropic' NOT NULL,
	"cheap_model_id" varchar(64) DEFAULT 'claude-haiku-4-5-20251001' NOT NULL,
	"standard_provider_id" varchar(32) DEFAULT 'anthropic' NOT NULL,
	"standard_model_id" varchar(64) DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"heavy_provider_id" varchar(32) DEFAULT 'anthropic' NOT NULL,
	"heavy_model_id" varchar(64) DEFAULT 'claude-opus-4-7' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "user_ai_preferences"
		ADD CONSTRAINT "user_ai_preferences_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
