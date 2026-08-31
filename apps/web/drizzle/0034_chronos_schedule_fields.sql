-- CHRONOS — scheduling fields on the board card.
--
-- Additive and reversible: every statement is ADD COLUMN IF NOT EXISTS or
-- CREATE INDEX IF NOT EXISTS, nothing is dropped, renamed or backfilled, and
-- re-running the file is a no-op. Rolling back is a DROP COLUMN of the ten
-- columns below, which no existing query reads.
--
-- APPLY THIS BEFORE src/lib/db/schema.ts DECLARES THESE COLUMNS. If the
-- Drizzle schema leads the database, every board query selects columns that
-- do not exist yet and 500s for live users.
--
-- Deliberately ABSENT: no new start/end date. board_tasks.start_date and
-- board_tasks.end_date keep their current meaning — the dates a human typed —
-- and become *inputs* to the solver. computed_start / computed_end are the
-- solver's output and are what the chart draws. Keeping intent and result in
-- separate columns is what lets a schedule be recomputed without ever
-- overwriting what the user asked for.
--
-- NOTE ON TYPES: these are plain `timestamp` (no time zone), matching every
-- other timestamp column in this database. An earlier draft used timestamp
-- on the theory that naive columns cause the west-of-UTC day-early bug. They
-- do not — that bug is caused by computing calendar boundaries in the SERVER's
-- zone, and it is fixed in lib/schedule/calendar.ts, which resolves every
-- boundary in the calendar's own IANA zone via Intl. The column type is
-- orthogonal so long as every writer stores a UTC instant, which the solver
-- does.
--
-- Mixing the two types actively hurt here: started_at is read as a PAIR with
-- the pre-existing completed_at (a done task occupies [started_at,
-- completed_at]). One zone-aware and one naive means the two halves of that
-- span resolve through different rules. Same for computed_* against the
-- existing start_date / end_date, which 0034 declares as solver inputs.
-- One convention, consistently applied, beats a half-migrated table.

-- Planned effort in minutes. NULL = not estimated: the solver still places the
-- task, at a default span, but excludes it from capacity and reports it in the
-- finish-date caveat rather than silently pretending it was measured.
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "estimate_minutes" integer;

-- 'auto'   — the solver owns this task's dates.
-- 'manual' — the user pinned it; the solver schedules around it.
ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "schedule_mode" varchar(10) NOT NULL DEFAULT 'auto';

-- Scheduling constraint. The v1 vocabulary is exactly three values, matching
-- ConstraintType in src/lib/schedule/types.ts: 'asap' (default), 'snet'
-- (start-no-earlier-than) and 'fnlt' (finish-no-later-than, which is how a
-- sprint end or release date is expressed — as a constraint on a milestone
-- task, never as a field on the project). constraint_date is required by snet
-- and fnlt, and unused by asap. varchar(24) leaves room to widen the
-- vocabulary later without a type change.
ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "constraint_type" varchar(24) NOT NULL DEFAULT 'asap';
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "constraint_date" timestamp;

-- Solver output. NULL = this task has never been scheduled, which is the
-- state every existing row starts in — no backfill, so the chart keeps
-- falling back to start_date / end_date until a schedule is computed.
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "computed_start" timestamp;
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "computed_end" timestamp;

-- Slack in minutes against the project finish. 0 = on the critical path.
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "total_float_min" integer;

-- Zero-duration marker — drawn as a diamond, ignored by levelling.
ALTER TABLE "board_tasks"
  ADD COLUMN IF NOT EXISTS "is_milestone" boolean NOT NULL DEFAULT false;

-- The resource this task consumes capacity from. Bare uuid here because the
-- resources table does not exist until 0035; that migration adds the foreign
-- key once its target is in place.
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "owner_resource_id" uuid;

-- Actuals: when work really began, as opposed to when it was planned to.
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "started_at" timestamp;

-- The timeline read: one project's scheduled tasks in start order. Partial so
-- the index only carries rows the solver has actually placed, which today is
-- none of them and in practice is a small fraction of the board.
--
-- Plain CREATE INDEX rather than CONCURRENTLY, matching every other migration
-- in this folder: board_tasks is beta-sized, so the SHARE lock (which blocks
-- writes but never reads) is held for milliseconds. If this table has grown by
-- the time it is applied, run the concurrent form instead, on its own, outside
-- any transaction block:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "board_tasks_project_computed_start_idx"
--     ON "board_tasks" ("project_id", "computed_start")
--     WHERE "computed_start" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "board_tasks_project_computed_start_idx"
  ON "board_tasks" ("project_id", "computed_start")
  WHERE "computed_start" IS NOT NULL;
