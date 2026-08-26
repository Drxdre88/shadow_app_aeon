#!/usr/bin/env node
// One-off — applies drizzle/0032_virtual_members.sql via raw SQL because the
// drizzle journal is frozen and drizzle-kit push diffs unrelated manual objects.
// Mirrors apply-favorites-migration.mjs.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS virtual_members (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     realm_id       uuid NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
     name           varchar(120) NOT NULL,
     initials       varchar(4) NOT NULL,
     color          varchar(20) NOT NULL DEFAULT 'purple',
     created_by_id  uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at     timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS virtual_members_realm_idx
     ON virtual_members (realm_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS task_virtual_assignees (
     task_id            uuid NOT NULL REFERENCES board_tasks(id) ON DELETE CASCADE,
     virtual_member_id  uuid NOT NULL REFERENCES virtual_members(id) ON DELETE CASCADE,
     assigned_by        uuid REFERENCES users(id) ON DELETE SET NULL,
     assigned_at        timestamp NOT NULL DEFAULT now(),
     PRIMARY KEY (task_id, virtual_member_id)
   )`,
  `CREATE INDEX IF NOT EXISTS task_virtual_assignees_member_idx
     ON task_virtual_assignees (virtual_member_id, assigned_at)`,
  `CREATE INDEX IF NOT EXISTS task_virtual_assignees_task_idx
     ON task_virtual_assignees (task_id)`,
]

let failed = 0
for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 80))
  } catch (err) {
    failed++
    console.error('FAIL:', stmt.split('\n')[0].slice(0, 80), err.message)
  }
}

const [{ vm, tva }] = await sql`
  SELECT to_regclass('public.virtual_members')::text AS vm,
         to_regclass('public.task_virtual_assignees')::text AS tva
`
console.log(`\nverify: virtual_members=${vm} task_virtual_assignees=${tva}`)
process.exit(failed > 0 || !vm || !tva ? 1 : 0)
