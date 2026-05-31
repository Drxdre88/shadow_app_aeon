-- Aeon side quest — Trello-style multi-assign on board cards.
--
-- One row per (task, user) pair. Adds an audit trail (who assigned, when)
-- which the activity feed reads to render "Alice assigned Bob to <task>".

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id      uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at  timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_user_idx
  ON task_assignees (user_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS task_assignees_task_idx
  ON task_assignees (task_id);
