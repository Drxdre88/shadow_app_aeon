ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "board_version" integer DEFAULT 0 NOT NULL;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_board_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD) THEN
    RETURN NEW;
  END IF;
  UPDATE projects
  SET board_version = board_version + 1,
      updated_at = now()
  WHERE id = COALESCE(NEW.project_id, OLD.project_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_board_version_via_task()
RETURNS TRIGGER AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT project_id INTO pid
  FROM board_tasks
  WHERE id = COALESCE(NEW.task_id, OLD.task_id)
  LIMIT 1;

  IF pid IS NOT NULL THEN
    UPDATE projects
    SET board_version = board_version + 1,
        updated_at = now()
    WHERE id = pid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION bump_board_version_via_dep()
RETURNS TRIGGER AS $$
DECLARE
  pid1 uuid;
  pid2 uuid;
BEGIN
  SELECT project_id INTO pid1
  FROM board_tasks
  WHERE id = COALESCE(NEW.blocker_task_id, OLD.blocker_task_id)
  LIMIT 1;

  SELECT project_id INTO pid2
  FROM board_tasks
  WHERE id = COALESCE(NEW.blocked_task_id, OLD.blocked_task_id)
  LIMIT 1;

  UPDATE projects
  SET board_version = board_version + 1,
      updated_at = now()
  WHERE id IN (pid1, pid2) AND id IS NOT NULL;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_board_tasks_version
  AFTER INSERT OR UPDATE OR DELETE ON board_tasks
  FOR EACH ROW EXECUTE FUNCTION bump_board_version();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_board_columns_version
  AFTER INSERT OR UPDATE OR DELETE ON board_columns
  FOR EACH ROW EXECUTE FUNCTION bump_board_version();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_labels_version
  AFTER INSERT OR UPDATE OR DELETE ON labels
  FOR EACH ROW EXECUTE FUNCTION bump_board_version();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_task_labels_version
  AFTER INSERT OR DELETE ON task_labels
  FOR EACH ROW EXECUTE FUNCTION bump_board_version_via_task();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_task_dependencies_version
  AFTER INSERT OR DELETE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION bump_board_version_via_dep();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_checklist_items_version
  AFTER INSERT OR UPDATE OR DELETE ON checklist_items
  FOR EACH ROW EXECUTE FUNCTION bump_board_version_via_task();

--> statement-breakpoint

CREATE OR REPLACE TRIGGER trg_task_comments_version
  AFTER INSERT OR UPDATE OR DELETE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION bump_board_version_via_task();
