CREATE TABLE "project_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'editor' NOT NULL,
	"invited_by" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"accepted_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'editor' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invites" ADD CONSTRAINT "project_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "project_members" ("project_id", "user_id", "role")
SELECT "id", "user_id", 'owner' FROM "projects"
ON CONFLICT DO NOTHING;