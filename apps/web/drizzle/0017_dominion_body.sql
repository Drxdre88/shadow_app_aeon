-- Kairos Phase 1 (C11) — Dominion body.
--
-- A Dominion gets standing context so the Briefer (E20) has something to
-- compare the day's state against. Without this, every advisory is starting
-- from zero. With this, the Briefer can say "you said the mission was X;
-- here's how today moved you toward or away from it."
--
-- New columns on dominions:
--   vision        text       — the long-form statement of what this Dominion is for.
--   mission_long  text       — the operating mission (HOW vs vision's WHAT).
--   archived_at   timestamp  — soft-delete; archived Dominions don't get briefed.
--
-- New table: dominion_objectives
--   Concrete, trackable goals scoped to a Dominion. The Briefer references
--   the open ones; closed ones survive for retrospective context.

ALTER TABLE dominions
  ADD COLUMN IF NOT EXISTS vision        text,
  ADD COLUMN IF NOT EXISTS mission_long  text,
  ADD COLUMN IF NOT EXISTS archived_at   timestamp;

CREATE INDEX IF NOT EXISTS dominions_archived_idx ON dominions (user_id, archived_at);

CREATE TABLE IF NOT EXISTS dominion_objectives (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dominion_id   uuid NOT NULL REFERENCES dominions(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         varchar(255) NOT NULL,
  description   text,
  -- 'active' | 'paused' | 'completed' | 'abandoned' — enforced by the Zod
  -- validator in lib/data/validators.ts (dominionObjectiveStatusSchema).
  status        varchar(20)  NOT NULL DEFAULT 'active',
  target_date   timestamp,
  sort_order    integer      NOT NULL DEFAULT 0,
  archived_at   timestamp,
  created_at    timestamp    NOT NULL DEFAULT now(),
  updated_at    timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dominion_objectives_dominion_idx
  ON dominion_objectives (dominion_id, sort_order);
CREATE INDEX IF NOT EXISTS dominion_objectives_user_status_idx
  ON dominion_objectives (user_id, status);
