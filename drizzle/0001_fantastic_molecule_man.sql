CREATE TABLE "task_vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"original_task_id" uuid,
	"name" varchar(255) NOT NULL,
	"description" text,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"color" varchar(20) DEFAULT 'purple' NOT NULL,
	"column_name" varchar(255),
	"size" real,
	"days_taken" integer,
	"label_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checklist_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp DEFAULT now() NOT NULL,
	"original_created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_vault" ADD CONSTRAINT "task_vault_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;