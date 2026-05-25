-- Kairos Phase 1 (B10) — Engine Router policy table.
--
-- Each row maps a (task_type, sensitivity, urgency) selector to the
-- preferred engine for that call. The router falls back to runtime
-- DEFAULT_POLICIES constants when no row matches, so the table can stay
-- empty in dev — overrides land on top of sane defaults.
--
-- user_id is nullable: NULL = global default (admin-seeded), set = user
-- override. The router resolves user-scoped rows first, then falls through
-- to globals, then to constants.

CREATE TABLE IF NOT EXISTS engine_policies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  -- e.g. 'brief', 'classify', 'code', 'advisory', 'shell_heavy', 'voice'
  task_type   varchar(40) NOT NULL,
  -- 'public' | 'private' | 'sensitive' — sensitive payloads avoid hosted
  -- providers when an alternative exists.
  sensitivity varchar(20) NOT NULL DEFAULT 'public',
  -- 'low' | 'normal' | 'high' — high-urgency may bypass cheap tier.
  urgency     varchar(20) NOT NULL DEFAULT 'normal',
  -- Engine selection. provider_id maps to lib/ai/providers.ts ProviderId
  -- (anthropic / openai / google) or future engines (openrouter / staf /
  -- codex / ollama). tier ('cheap' / 'standard' / 'heavy') is used when
  -- provider_id is the literal 'byok' so the router resolves through user
  -- preferences.
  provider_id varchar(40) NOT NULL,
  model_id    varchar(120),
  tier        varchar(20),
  priority    integer NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engine_policies_user_task_idx
  ON engine_policies (user_id, task_type, priority DESC);
CREATE INDEX IF NOT EXISTS engine_policies_task_idx
  ON engine_policies (task_type, priority DESC);
