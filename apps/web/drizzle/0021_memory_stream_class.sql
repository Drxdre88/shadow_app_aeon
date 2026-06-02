-- Kairos Phase 2 — Block A1 — three-layer memory model classifier.
--
-- The brain currently treats every memory as the same kind of thing: free-form
-- prose with a type ('note', 'reflection', 'idea'…). The evolution plan in
-- docs/kairos/12-kairos-evolution-plan.md §"Three-layer memory model" replaces
-- that flat treatment with a stream class — the answer to "which layer of the
-- brain does this row belong to?".
--
-- Stream classes:
--   'agentic'     produced by an agent session (claude / future agents)
--   'execution'   board / project / cron / import activity ("what was done")
--   'idea'        free-form user thought (default for manual notes)
--   'reflection'  owner-fired first-class signal — higher weight, can override drift
--   'archetype'   Kairos-synthesised master node per Dominion (Phase 1B; not backfilled)
--   'cortex'      living Dominion document (Phase 1B; not backfilled)
--
-- Forward path:
--   1. Add the column with default 'idea'.
--   2. Backfill existing rows by inference from `type`, `source`, and source_metadata.
--   3. Add a (user_id, stream_class) index for the substrate filter that the
--      cosmic view's tier filters will hit.

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS stream_class varchar(20) NOT NULL DEFAULT 'idea';

-- Backfill order matters: more-specific rules first so later UPDATEs don't
-- overwrite them. Each UPDATE is idempotent (it only re-asserts the same
-- value if re-run).

-- Reflections — already typed as such, promote to first-class stream.
UPDATE memories
   SET stream_class = 'reflection'
 WHERE type = 'reflection';

-- Agentic — anything produced by a claude/agent session.
UPDATE memories
   SET stream_class = 'agentic'
 WHERE source IN ('claude', 'agent_session')
   AND stream_class = 'idea';

-- Execution — board/project import + scheduled briefer/snapshot output.
UPDATE memories
   SET stream_class = 'execution'
 WHERE (
         (source = 'import' AND source_metadata->>'kind' = 'board_task_backfill')
      OR  source = 'cron'
      OR (source = 'system' AND source_metadata->>'kind' IN ('board_action', 'project_event'))
       )
   AND stream_class = 'idea';

-- All remaining rows keep the column default of 'idea' — free-form thoughts,
-- manual captures, the existing rough substrate.

CREATE INDEX IF NOT EXISTS memories_stream_class_idx
  ON memories (user_id, stream_class);
