-- Kairos exec summary support.
--
-- Two new nullable fields on `memories`:
--   ai_title       text — AI-generated short title (1–6 words). The display
--                  layer falls back to `title` when null.
--   exec_summary   jsonb default [] — array of clean bullet points (5–10).
--                  Front-of-house in the side panel; raw body is collapsed.
--
-- Both populated asynchronously after writes (BYOK fire-and-forget) and via
-- the MCP `regenerate_summaries` bulk tool. No backfill — the daily cron
-- walks `WHERE jsonb_array_length(exec_summary) = 0` in batches of 50.

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS ai_title varchar(120),
  ADD COLUMN IF NOT EXISTS exec_summary jsonb NOT NULL DEFAULT '[]'::jsonb;
