#!/usr/bin/env node
// One-off — applies drizzle/0034_chronos_schedule_fields.sql then
// 0035_chronos_resources_calendars.sql via raw SQL, because the drizzle
// journal is frozen at 0010 and `db:migrate` would read it, see nothing past
// 0010, and report success having applied nothing.
//
// DRY RUN BY DEFAULT. Nothing executes without --commit. That matters more
// than usual here: dev and production share one Neon database, so every
// statement below is a live write against real beta users' data.
//
// Pool, not the neon() HTTP driver: HTTP sends each statement as its own
// request with no session, so there would be no transaction at all. A pooled
// client runs the whole apply inside one BEGIN/COMMIT. Every statement is
// already IF NOT EXISTS so a partial apply would be recoverable by re-running,
// but atomicity is free here and worth taking.
//
// Both files are additive: nothing is dropped, renamed or backfilled, and a
// second run is a no-op.
//
// NEVER run `db:push` on this branch. schema.ts does not declare these objects
// yet, so drizzle-kit diffs them as drift and emits DROP statements for them.

import { Pool } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', 'drizzle')
const FILES = ['0034_chronos_schedule_fields.sql', '0035_chronos_resources_calendars.sql']

const commit = process.argv.includes('--commit')

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })

const OBJECT_PROBE = `
  SELECT
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'board_tasks'
        AND column_name IN ('estimate_minutes','schedule_mode','constraint_type',
          'constraint_date','computed_start','computed_end','total_float_min',
          'is_milestone','owner_resource_id','started_at')) AS board_task_cols,
    to_regclass('public.work_calendars')::text      AS work_calendars,
    to_regclass('public.calendar_exceptions')::text AS calendar_exceptions,
    to_regclass('public.resources')::text           AS resources,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conname = 'board_tasks_owner_resource_id_fkey') AS owner_fk
`

/**
 * Split a file into statements on top-level semicolons only. Tracks dollar
 * quoting so the guarded DO $$ ... $$ block in 0035 stays ONE statement —
 * splitting it on its internal semicolons would break the dollar-quoted body —
 * and ignores semicolons inside line comments and string literals.
 */
function statements(text) {
  const out = []
  let buf = ''
  let i = 0
  let inLine = false, inStr = false, dollarTag = null
  while (i < text.length) {
    const ch = text[i]
    const rest = text.slice(i)
    if (inLine) {
      if (ch === '\n') inLine = false
      buf += ch; i++; continue
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; continue }
      buf += ch; i++; continue
    }
    if (inStr) {
      if (ch === "'") inStr = false
      buf += ch; i++; continue
    }
    if (rest.startsWith('--')) { inLine = true; buf += ch; i++; continue }
    if (ch === "'") { inStr = true; buf += ch; i++; continue }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/)
    if (dollar) { dollarTag = dollar[0]; buf += dollarTag; i += dollarTag.length; continue }
    if (ch === ';') { out.push(buf.trim()); buf = ''; i++; continue }
    buf += ch; i++
  }
  if (buf.trim()) out.push(buf.trim())
  return out.filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0)
}

function summarise(row, heading) {
  console.log(heading)
  console.log(`  board_tasks schedule columns: ${row.board_task_cols}/10`)
  console.log(`  work_calendars=${row.work_calendars ?? 'absent'}` +
    ` calendar_exceptions=${row.calendar_exceptions ?? 'absent'}` +
    ` resources=${row.resources ?? 'absent'}`)
  console.log(`  owner_resource_id FK: ${row.owner_fk === 1 ? 'present' : 'absent'}`)
}

const { rows: [pre] } = await pool.query(OBJECT_PROBE)
summarise(pre, 'pre-flight:')

const planned = FILES.map((f) => ({ file: f, stmts: statements(readFileSync(join(drizzleDir, f), 'utf8')) }))
console.log('\nplan:')
for (const { file, stmts } of planned) console.log(`  ${file}: ${stmts.length} statements`)

if (!commit) {
  console.log('\nDRY RUN — nothing executed. Re-run with --commit to apply.')
  console.log('Reminder: this database is production. There is no separate prod step.')
  await pool.end()
  process.exit(0)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const { file, stmts } of planned) {
    console.log(`\napplying ${file}`)
    for (const [n, statement] of stmts.entries()) {
      const label = statement.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().slice(0, 78)
      await client.query(statement)
      console.log(`  OK   [${n + 1}/${stmts.length}] ${label}`)
    }
  }
  await client.query('COMMIT')
  console.log('\nCOMMIT')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\nFAILED — rolled back. The database is unchanged.')
  console.error(`  ${err.message}`)
  client.release()
  await pool.end()
  process.exit(1)
} finally {
  client.release()
}

const { rows: [post] } = await pool.query(OBJECT_PROBE)
summarise(post, '\nverify:')

const ok = post.board_task_cols === 10 && post.work_calendars && post.calendar_exceptions
  && post.resources && post.owner_fk === 1
console.log(ok ? '\nAll objects present.' : '\nSomething is missing — inspect above.')
console.log('schema.ts still does NOT declare these. Update it only now that the database has them.')
await pool.end()
process.exit(ok ? 0 : 1)
