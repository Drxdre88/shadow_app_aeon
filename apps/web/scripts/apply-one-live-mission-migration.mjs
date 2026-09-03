#!/usr/bin/env node
// One-off — applies drizzle/0033_one_live_mission_per_card.sql via raw SQL
// because the drizzle journal is frozen and drizzle-kit push diffs unrelated
// manual objects. Mirrors apply-virtual-members-migration.mjs.
//
// Pre-flight matters here: the index is UNIQUE, so it cannot be created while
// a card already carries two live sessions. Those are reported, not deleted —
// a live row may be a real agent someone is watching.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const dupes = await sql`
  SELECT task_id, count(*)::int AS live
  FROM agent_sessions
  WHERE task_id IS NOT NULL AND status IN ('queued', 'running')
  GROUP BY task_id
  HAVING count(*) > 1
`

if (dupes.length > 0) {
  console.error('Cannot create the unique index — these cards already have multiple live missions:')
  for (const row of dupes) console.error(`  task ${row.task_id}: ${row.live} live sessions`)
  console.error('\nResolve them first (kill the extras), then re-run.')
  process.exit(1)
}
console.log('pre-flight: no card has more than one live mission')

const statement = `CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_one_live_per_task_idx"
  ON "agent_sessions" ("task_id")
  WHERE "task_id" IS NOT NULL AND "status" IN ('queued', 'running')`

try {
  await sql(statement)
  console.log('OK: agent_sessions_one_live_per_task_idx')
} catch (err) {
  console.error('FAIL:', err.message)
  process.exit(1)
}

const [{ idx }] = await sql`
  SELECT to_regclass('public.agent_sessions_one_live_per_task_idx')::text AS idx
`
console.log(`\nverify: index=${idx}`)
process.exit(idx ? 0 : 1)
