CREATE TABLE IF NOT EXISTS "user_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_email" varchar(255) NOT NULL,
	"contact_user_id" uuid,
	"display_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_user_email_uniq" ON "user_contacts" ("user_id", "contact_email");
