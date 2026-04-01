ALTER TABLE "workspace_groups" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;

--> statement-breakpoint

CREATE UNIQUE INDEX "workspace_groups_personal_per_user" ON "workspace_groups" ("owner_id") WHERE "is_personal" = true;
