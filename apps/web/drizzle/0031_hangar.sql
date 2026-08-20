-- AI Hangar (Sprint 1) — card↔session link, pull-mode claim bookkeeping and
-- the realm-scoped repo registry.
--
-- agent_sessions gains task_id (the board card the mission came from) plus the
-- claim/heartbeat columns the polling runner writes. task_id IS NOT NULL is the
-- claim filter that keeps kairos-chat / dialogue threads (which share this
-- table) out of the runner queue.

ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES board_tasks(id) ON DELETE SET NULL;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS claimed_by varchar(120);
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS claimed_at timestamp;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamp;

CREATE INDEX IF NOT EXISTS agent_sessions_task_idx
  ON agent_sessions (task_id);

-- The claim query: oldest queued, card-backed session for one user. Partial so
-- it stays tiny (finished sessions drop out) and the runner's poll never scans
-- the chat/dialogue rows sharing this table.
CREATE INDEX IF NOT EXISTS agent_sessions_claim_idx
  ON agent_sessions (user_id, spawned_at)
  WHERE status = 'queued' AND task_id IS NOT NULL;


-- Logical repo config only. Host-local disk paths stay runner-side in
-- repos.local.yaml so multiple runner hosts can serve the same registry.
CREATE TABLE IF NOT EXISTS hangar_repos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id        uuid NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
  -- Matches the repo:* label taxonomy used on the boards.
  slug            varchar(120) NOT NULL,
  name            varchar(255) NOT NULL,
  git_url         text NOT NULL,
  -- owner/repo — required for the copilot-cloud assign path.
  gh_slug         varchar(200),
  default_branch  varchar(120) NOT NULL DEFAULT 'main',
  branch_prefix   varchar(60) NOT NULL DEFAULT 'aeon/',
  -- ['claude' | 'copilot' | 'codex'] — engines this repo is onboarded for.
  allowed_engines jsonb NOT NULL DEFAULT '[]',
  -- Only needed by missions that must run the live app.
  run_cmd         text,
  env_setup_cmd   text,
  app_url         text,
  notes           text,
  active          boolean NOT NULL DEFAULT true,
  -- Runner-reported capabilities (engines detected, skills discovered).
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hangar_repos_realm_slug_idx
  ON hangar_repos (realm_id, slug);
CREATE INDEX IF NOT EXISTS hangar_repos_realm_active_idx
  ON hangar_repos (realm_id, active);
