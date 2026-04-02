ALTER TABLE "project_groups" ADD COLUMN "visibility" varchar(20) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "board_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_groups" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_contacts_user_email_uniq" ON "user_contacts" USING btree ("user_id","contact_email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_groups_personal_per_user" ON "workspace_groups" USING btree ("owner_id") WHERE is_personal = true;