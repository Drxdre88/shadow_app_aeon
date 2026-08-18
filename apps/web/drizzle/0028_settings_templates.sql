-- Admin-curated default preference sets (e.g. 'business_admin'), stamped into
-- user_preferences at account creation. Editable only by role=admin.
CREATE TABLE IF NOT EXISTS "settings_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(50) NOT NULL UNIQUE,
  "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
