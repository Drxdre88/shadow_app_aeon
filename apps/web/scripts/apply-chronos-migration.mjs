#!/usr/bin/env node
// One-off — applies drizzle/0034_chronos_schedule_fields.sql then
// 0035_chronos_resources_calendars.sql via raw SQL, because the drizzle
// journal is frozen at 0010 and `db:migrate` would report success having
// applied nothing. Mirrors apply-one-live-mission-migration.mjs.
//
// DRY RUN BY DEFAULT. Nothing executes without --commit. This matters more
// than usual here: dev and production share one Neon database, so every
// statement below is a live write against real beta users' data.
//
// Both files are additive and re-runnable (ADD COLUMN IF NOT EXISTS /
// CREATE TABLE IF NOT EXISTS / guarded DO block), so a second run is a no-op.
// Neither drops, renames or backfills anything.
//
// NEVER run `db:push` on this branch — schema.ts does not declare these
// objects, so drizzle-kit would compute them as drift and offer to drop them.

import { neon } from '@neondatabase/serverless'
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
const sql = neon(url)

/**
 * Split a file into statements on top-level semicolons only. Tracks dollar
 * quoting so the guarded DO $$ ... $$ block in 0035 stays ONE statement —
 * splitting it on semicolons breaks the dollar-quoted body — and skips
 * semicolons inside line comments and string literals.
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

// ---- pre-flight: report what already exists, so a re-run is legible --------
const [pre] = await sql`
  SELECT
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'board_tasks'
        AND column_name IN ('estimate_minutes','schedule_mode','constraint_type',
          'constraint_date','computed_start','computed_end','total_float_min',
          'is_milestone','owner_resource_id','started_at')) AS board_task_cols,
    to_regclass('public.work_calendars')::text     AS work_calendars,
    to_regclass('public.calendar_exceptions')::text AS calendar_exceptions,
    to_regclass('public.resources')::text          AS resources
`
console.log('pre-flight:')
console.log(`  board_tasks schedule columns present: ${pre.board_task_cols}/10`)
console.log(`  work_calendars=${pre.work_calendars ?? 'absent'} calendar_exceptions=${pre.calendar_exceptions ?? 'absent'} resources=${pre.resources ?? 'absent'}`)

const planned = FILES.map((f) => ({ file: f, stmts: statements(readFileSync(join(drizzleDir, f), 'utf8')) }))
console.log('\nplan:')
for (const { file, stmts } of planned) console.log(`  ${file}: ${stmts.length} statements`)

if (!commit) {
  console.log('\nDRY RUN — nothing executed. Re-run with --commit to apply.')
  console.log('Reminder: this database is production. There is no separate prod step.')
  process.exit(0)
}

// ---- apply ----------------------------------------------------------------
for (const { file, stmts } of planned) {
  console.log(`\napplying ${file}`)
  for (const [n, statement] of stmts.entries()) {
    const label = statement.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().slice(0, 78)
    try {
      await sql(statement)
      console.log(`  OK   [${n + 1}/${stmts.length}] ${label}`)
    } catch (err) {
      console.error(`  FAIL [${n + 1}/${stmts.length}] ${label}`)
      console.error(`       ${err.message}`)
      process.exit(1)
    }
  }
}

// ---- verify ---------------------------------------------------------------
const [post] = await sql`
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
console.log('\nverify:')
console.log(`  board_tasks schedule columns: ${post.board_task_cols}/10`)
console.log(`  work_calendars=${post.work_calendars} calendar_exceptions=${post.calendar_exceptions} resources=${post.resources}`)
console.log(`  owner_resource_id FK: ${post.owner_fk === 1 ? 'present' : 'MISSING'}`)

const ok = post.board_task_cols === 10 && post.work_calendars && post.calendar_exceptions
  && post.resources && post.owner_fk === 1
console.log(ok ? '\nAll objects present.' : '\nSomething is missing — inspect above.')
console.log('schema.ts still does NOT declare these. Update it only now that the database has them.')
process.exit(ok ? 0 : 1)
