-- Kairos Phase 3 (D15) — Spawn primitive substrate.
--
-- agent_sessions tracks live and historical AI sessions Kairos has dispatched
-- on the operator's behalf (Claude Code, Codex, future engines). Each row is
-- one "hands" job. session_events is the per-session timeline emitted by the
-- worker host or by the Claude Code PostToolUse / Stop hooks.
--
-- Lifecycle: row created on spawnSession() with status='queued', worker host
-- updates to 'running' once it shells the CLI, then 'succeeded' / 'failed' /
-- 'killed' / 'timeout' at termination. On 'succeeded' a memory row is created
-- and linked via memory_id so the next briefing can reference the work.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  realm_id     uuid REFERENCES workspace_groups(id) ON DELETE SET NULL,
  project_id   uuid REFERENCES projects(id) ON DELETE SET NULL,
  dominion_id  uuid REFERENCES dominions(id) ON DELETE SET NULL,
  -- 'claude' | 'codex' | future engines
  engine       varchar(40) NOT NULL,
  -- Repository slug (e.g. 'shadow_app_aeon') the session runs against.
  repo         varchar(200),
  branch       varchar(120),
  -- One-line operator-facing goal (what success looks like).
  goal         text NOT NULL,
  -- The actual prompt sent to the engine. Stored verbatim for reproducibility.
  prompt       text NOT NULL,
  -- Worker host bookkeeping. pid is the CLI process id on the worker.
  worker_host  varchar(120),
  worker_pid   integer,
  -- 'queued' | 'running' | 'succeeded' | 'failed' | 'killed' | 'timeout'
  status       varchar(20) NOT NULL DEFAULT 'queued',
  exit_code    integer,
  spawned_at   timestamp NOT NULL DEFAULT now(),
  started_at   timestamp,
  ended_at     timestamp,
  -- Optional cost tally when the engine reports it (Claude Code emits this
  -- on Stop). Numeric to avoid floating-point drift across many small calls.
  cost_usd     numeric(10, 4),
  -- Memory row created on success (session summary). Forward link only — the
  -- memory itself doesn't need to know it came from a session.
  memory_id    uuid REFERENCES memories(id) ON DELETE SET NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_sessions_user_status_idx
  ON agent_sessions (user_id, status, spawned_at DESC);
CREATE INDEX IF NOT EXISTS agent_sessions_dominion_idx
  ON agent_sessions (dominion_id, spawned_at DESC);
CREATE INDEX IF NOT EXISTS agent_sessions_live_idx
  ON agent_sessions (user_id, spawned_at DESC) WHERE status IN ('queued', 'running');


CREATE TABLE IF NOT EXISTS session_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  -- Monotonic per-session sequence; the worker / hook is responsible for
  -- incrementing. UNIQUE ensures replay safety if the hook double-posts.
  seq         integer NOT NULL,
  -- 'status' | 'tool_use' | 'tool_result' | 'message' | 'stop' | 'error'
  kind        varchar(40) NOT NULL,
  -- Optional helper for fast filtering ("show me all Edit calls").
  tool_name   varchar(80),
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamp NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS session_events_session_seq_idx
  ON session_events (session_id, seq);
-- Drives the eventual archival cron — events older than N days get vaulted.
CREATE INDEX IF NOT EXISTS session_events_created_idx
  ON session_events (created_at);
