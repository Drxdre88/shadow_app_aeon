-- Task progress percentage (0-100, app-enforced; NULL = not tracked).
-- Drives the in-card progress bar ('p' shortcut).
ALTER TABLE "board_tasks" ADD COLUMN IF NOT EXISTS "progress" integer;
