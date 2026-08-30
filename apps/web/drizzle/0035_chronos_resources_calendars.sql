-- CHRONOS — work calendars and resources.
--
-- Additive and reversible: three new tables, plus a foreign key and an index
-- on the owner_resource_id column that 0034 added. Nothing is dropped,
-- rewritten or backfilled — the only touch to an existing table is that FK,
-- which validates instantly because every owner_resource_id is still NULL.
-- Every statement is guarded, so a re-run is a no-op. Rolling back is a DROP
-- TABLE of the three tables (cascading the new FK); no current query reads
-- any of them.
--
-- APPLY AFTER 0034 AND BEFORE src/lib/db/schema.ts DECLARES THESE TABLES.
-- 0034 must land first because the foreign key at the bottom of this file
-- targets board_tasks.owner_resource_id.
--
-- If this is applied through a scripts/apply-*.mjs statement array rather
-- than psql, the DO $$ ... $$ block at the end must stay ONE array entry —
-- splitting it on semicolons breaks the dollar-quoted body.
--
-- Shape: a work_calendar says what a normal week looks like, a
-- calendar_exception overrides one specific day, and a resource is the thing
-- that does the work — a real Aeon user, a virtual member (someone without an
-- account), or an agent. Calendars are separate from resources so a team can
-- share one working week without duplicating it per person.


-- Working-time definition. project_id is the owner, so deleting a project
-- takes its calendars with it.
CREATE TABLE IF NOT EXISTS work_calendars (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           varchar(120) NOT NULL,
  -- IANA zone. Every timestamptz the solver writes is absolute; this is what
  -- turns it back into "9am on someone's Tuesday".
  timezone       text NOT NULL DEFAULT 'Europe/London',
  hours_per_day  numeric(4,2) NOT NULL DEFAULT 8,
  -- Bitmask of working days, bit 0 = Sunday .. bit 6 = Saturday.
  -- 62 = 0b0111110 = Monday through Friday.
  workweek       smallint NOT NULL DEFAULT 62,
  created_at     timestamp NOT NULL DEFAULT now(),
  updated_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_calendars_project_idx
  ON work_calendars (project_id, created_at);

-- One row per overridden day. is_working = false is a holiday; is_working =
-- true with hours set is a working weekend or a short day. hours NULL on a
-- working exception means "the calendar's normal hours_per_day".
CREATE TABLE IF NOT EXISTS calendar_exceptions (
  calendar_id  uuid NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
  day          date NOT NULL,
  is_working   boolean NOT NULL DEFAULT false,
  hours        numeric(4,2),
  created_at   timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (calendar_id, day)
);

-- Who (or what) the work is assigned to. Three kinds share one table so the
-- solver has a single capacity list to level against, and parent_resource_id
-- lets resources roll up into teams.
CREATE TABLE IF NOT EXISTS resources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'user' | 'virtual' | 'agent'
  kind                 varchar(12) NOT NULL,
  user_id              uuid REFERENCES users(id) ON DELETE CASCADE,
  virtual_member_id    uuid REFERENCES virtual_members(id) ON DELETE CASCADE,
  -- Self-reference: a team resource that this one belongs to. SET NULL so
  -- dissolving a team does not delete its people.
  parent_resource_id   uuid REFERENCES resources(id) ON DELETE SET NULL,
  -- SET NULL rather than CASCADE: losing a calendar must not delete a person.
  calendar_id          uuid REFERENCES work_calendars(id) ON DELETE SET NULL,
  -- Display name. For kind='user'/'virtual' this is a cached label; the
  -- authoritative name still lives on users / virtual_members.
  label                varchar(120),
  -- How many tasks this resource can run at once.
  concurrency          integer NOT NULL DEFAULT 1,
  -- Fraction of a working day actually available for project work.
  focus_factor         numeric(3,2) NOT NULL DEFAULT 1.0,
  order_index          integer NOT NULL DEFAULT 0,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now(),
  -- The identity rule, enforced here rather than in the app because three
  -- write surfaces (server actions, REST, MCP) can insert resources.
  CONSTRAINT resources_kind_identity_check CHECK (
    (kind = 'user'    AND user_id IS NOT NULL AND virtual_member_id IS NULL)
    OR (kind = 'virtual' AND virtual_member_id IS NOT NULL AND user_id IS NULL)
    OR (kind = 'agent'   AND user_id IS NULL AND virtual_member_id IS NULL)
  )
);

-- One resource per person per project. Partial so the agent rows, which have
-- both identity columns NULL, are not forced into a single row per project.
CREATE UNIQUE INDEX IF NOT EXISTS resources_project_user_idx
  ON resources (project_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS resources_project_virtual_member_idx
  ON resources (project_id, virtual_member_id)
  WHERE virtual_member_id IS NOT NULL;

-- The resource list read: one project's resources in display order.
CREATE INDEX IF NOT EXISTS resources_project_order_idx
  ON resources (project_id, order_index);


-- Close the loop on 0034: board_tasks.owner_resource_id was added bare
-- because this table did not exist yet. SET NULL so deleting a resource
-- unassigns its tasks instead of deleting them. Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, hence the guard — this keeps the file
-- re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'board_tasks_owner_resource_id_fkey'
  ) THEN
    ALTER TABLE board_tasks
      ADD CONSTRAINT board_tasks_owner_resource_id_fkey
      FOREIGN KEY (owner_resource_id) REFERENCES resources(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS board_tasks_owner_resource_idx
  ON board_tasks (owner_resource_id)
  WHERE owner_resource_id IS NOT NULL;
