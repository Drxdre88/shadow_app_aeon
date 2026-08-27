-- Auto AI: at most ONE live mission per board card.
--
-- The application checks for an existing queued/running session before
-- spawning, but that is a check-then-insert race, and three other spawn
-- surfaces (REST /api/v1/sessions, the MCP spawn tool, lib/actions/sessions)
-- create sessions without it. A duplicate here is not a cosmetic bug: every
-- extra row is another real agent on a real repo, opening its own branch.
--
-- A partial unique index makes the database the authority for every path, and
-- leaves terminal sessions (succeeded/failed/killed/timeout) unconstrained so
-- a card can be relaunched once its previous mission is done.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_one_live_per_task_idx"
  ON "agent_sessions" ("task_id")
  WHERE "task_id" IS NOT NULL AND "status" IN ('queued', 'running');
