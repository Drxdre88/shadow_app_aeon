-- Virtual team members — assignable people who don't use Aeon (no account,
-- no access). Realm-scoped so one virtual member is assignable across every
-- project in the realm, mirroring how real realm members become assignable
-- via group_members.

CREATE TABLE IF NOT EXISTS virtual_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id       uuid NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
  name           varchar(120) NOT NULL,
  -- Derived from name at creation but stored, so a rename doesn't silently
  -- change the avatar everyone recognises.
  initials       varchar(4) NOT NULL,
  color          varchar(20) NOT NULL DEFAULT 'purple',
  created_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS virtual_members_realm_idx
  ON virtual_members (realm_id, created_at);

-- Parallel assignment table to task_assignees — keeps every existing
-- real-member query (users join) untouched instead of widening
-- task_assignees with a nullable user_id + CHECK. ON DELETE CASCADE on
-- virtual_member_id makes member deletion clean its assignments atomically.
CREATE TABLE IF NOT EXISTS task_virtual_assignees (
  task_id            uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
  virtual_member_id  uuid NOT NULL REFERENCES virtual_members(id) ON DELETE CASCADE,
  assigned_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at        timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, virtual_member_id)
);

CREATE INDEX IF NOT EXISTS task_virtual_assignees_member_idx
  ON task_virtual_assignees (virtual_member_id, assigned_at);

CREATE INDEX IF NOT EXISTS task_virtual_assignees_task_idx
  ON task_virtual_assignees (task_id);
