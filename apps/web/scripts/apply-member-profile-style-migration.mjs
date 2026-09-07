#!/usr/bin/env node
// One-off — applies drizzle/0037_member_profile_style.sql via raw SQL, because
// the drizzle journal is frozen at 0010 and `db:migrate` would read it, see
// nothing past 0010, and report success having applied nothing.
//
// DRY RUN BY DEFAULT. Nothing executes without --commit. Dev and production
// share one Neon database, so every statement here is a live write against
// real beta users' data.
//
// Pool, not the neon() HTTP driver: HTTP sends each statement as its own
// request with no session, so there would be no transaction at all.
//
// Additive — two nullable columns, one CHECK swapped (DROP IF EXISTS + ADD) and
// one CHECK added. Every statement is idempotent, so a second run is a no-op
// and a partial apply is recoverable by re-running; the transaction makes the
// CHECK swap atomic so there is never a window with no not-empty rule.
//
// After applying, run `node scripts/verify-schema-drift.mjs` — schema.ts must
// declare these columns or a stray `db:push` would emit a DROP for them.

import { Pool } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', 'drizzle')
const FILES = ['0037_member_profile_style.sql']

const commit = process.argv.includes('--commit')

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })

const OBJECT_PROBE = `
  SELECT
    to_regclass('public.member_profiles')::text AS member_profiles,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'member_profiles'
        AND column_name IN ('text_color', 'shape')) AS style_columns,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = to_regclass('public.member_profiles')
        AND conname = 'member_profiles_not_empty_check') AS not_empty_def,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid = to_regclass('public.member_profiles')
        AND conname = 'member_profiles_shape_check') AS shape_check
`

/**
 * Split a file into statements on top-level semicolons only. Tracks dollar
 * quoting, line comments and string literals so none of their semicolons
 * split a statement.
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
  console.log(`  member_profiles: ${row.member_profiles ?? 'absent'}`)
  console.log(`  style columns (text_color, shape): ${row.style_columns}/2`)
  console.log(`  not-empty CHECK counts new columns: ${String(row.not_empty_def ?? '').includes('text_color') ? 'yes' : 'no'}`)
  console.log(`  shape CHECK: ${row.shape_check === 1 ? 'present' : 'absent'}`)
}

const oneLine = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const { rows: [pre] } = await pool.query(OBJECT_PROBE)
summarise(pre, 'pre-flight:')

const planned = FILES.map((f) => ({ file: f, stmts: statements(readFileSync(join(drizzleDir, f), 'utf8')) }))
console.log('\nplan:')
for (const { file, stmts } of planned) {
  console.log(`  ${file}: ${stmts.length} statements`)
  for (const s of stmts) console.log(`    - ${oneLine(s).slice(0, 100)}`)
}

if (!commit) {
  console.log('\nDRY RUN — nothing executed. Re-run with --commit to apply.')
  await pool.end()
  process.exit(0)
}

const client = await pool.connect()
try {
  await client.query('BEGIN')
  for (const { file, stmts } of planned) {
    console.log(`\napplying ${file}`)
    for (const [n, statement] of stmts.entries()) {
      process.stdout.write(`  ${n + 1}/${stmts.length} ${oneLine(statement).slice(0, 78)} ... `)
      await client.query(statement)
      console.log('ok')
    }
  }
  await client.query('COMMIT')
  console.log('\nCOMMIT')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('\nROLLBACK —', err.message)
  client.release()
  await pool.end()
  process.exit(1)
}
client.release()

const { rows: [post] } = await pool.query(OBJECT_PROBE)
console.log('')
summarise(post, 'post-flight:')

const ok = post.member_profiles !== null
  && post.style_columns === 2
  && String(post.not_empty_def ?? '').includes('text_color')
  && post.shape_check === 1
console.log(ok ? '\nApplied.' : '\nApplied, but the post-flight probe does not match — inspect before proceeding.')
await pool.end()
process.exit(ok ? 0 : 1)
