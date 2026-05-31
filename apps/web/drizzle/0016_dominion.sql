-- Kairos Dominion — top-level grouping above Project for the brain.
--
-- New tables:
--   dominions          user-scoped named buckets with colour + icon
--   dominion_repos     join table: which repo slugs belong to which Dominion
--                      so Claude-session memories auto-resolve their Dominion
--                      from sourceMetadata.repo.
--
-- New columns:
--   projects.dominion_id   nullable FK — a Project sits in one Dominion (1:N).
--                          On delete: set null (keep the project).
--   memories.dominion_id   nullable FK — direct override. Resolution order
--                          in the data layer:
--                            memory.dominion_id
--                              ?? project.dominion_id (via projectId)
--                              ?? lookup via dominion_repos[sourceMetadata.repo]
--                              ?? null  (= "Unassigned" cluster)
--
-- See VISION.md "K-3 Dominion" and Bet 5.

CREATE TABLE IF NOT EXISTS dominions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(100) NOT NULL,
  color       varchar(30)  NOT NULL DEFAULT 'purple',
  icon        varchar(50),
  sort_order  integer      NOT NULL DEFAULT 0,
  created_at  timestamp    NOT NULL DEFAULT now(),
  updated_at  timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dominions_user_idx ON dominions (user_id, sort_order);

CREATE TABLE IF NOT EXISTS dominion_repos (
  dominion_id uuid NOT NULL REFERENCES dominions(id) ON DELETE CASCADE,
  repo_slug   varchar(120) NOT NULL,
  PRIMARY KEY (dominion_id, repo_slug)
);

CREATE INDEX IF NOT EXISTS dominion_repos_slug_idx ON dominion_repos (repo_slug);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS dominion_id uuid REFERENCES dominions(id) ON DELETE SET NULL;

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS dominion_id uuid REFERENCES dominions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS memories_dominion_idx ON memories (dominion_id);
