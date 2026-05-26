#!/usr/bin/env node
// One-off — applies the task_assignees migration via raw SQL because
// drizzle-kit push wants to drop memories.fts (a manual generated column
// not modelled in schema.ts) and that's unrelated to this change.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS task_assignees (
     task_id      uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
     user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     assigned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
     assigned_at  timestamp NOT NULL DEFAULT now(),
     PRIMARY KEY (task_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS task_assignees_user_idx
     ON task_assignees (user_id, assigned_at DESC)`,
  `CREATE INDEX IF NOT EXISTS task_assignees_task_idx
     ON task_assignees (task_id)`,
]

for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 80))
  } catch (err) {
    console.error('FAIL:', stmt.split('\n')[0].slice(0, 80), err.message)
  }
}
