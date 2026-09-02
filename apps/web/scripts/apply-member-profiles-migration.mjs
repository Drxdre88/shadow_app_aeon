#!/usr/bin/env node
// One-off — applies drizzle/0036_member_profiles.sql via raw SQL, because the
// drizzle journal is frozen at 0010 and `db:migrate` would read it, see
// nothing past 0010, and report success having applied nothing.
//
// DRY RUN BY DEFAULT. Nothing executes without --commit. Dev and production
// share one Neon database, so every statement here is a live write against
// real beta users' data.
//
// Pool, not the neon() HTTP driver: HTTP sends each statement as its own
// request with no session, so there would be no transaction at all.
//
// The file is purely additive — one new table and one index, nothing dropped,
// renamed or backfilled — so a second run is a no-op and a partial apply is
// recoverable by re-running. Atomicity is free here regardless.
//
// After applying, run `node scripts/verify-schema-drift.mjs` — schema.ts must
// declare this table or a stray `db:push` would emit a DROP for it.

import { Pool } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const here = dirname(fileURLToPath(import.meta.url))
const drizzleDir = join(here, '..', 'drizzle')
const FILES = ['0036_member_profiles.sql']

const commit = process.argv.includes('--commit')

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })

const OBJECT_PROBE = `
  SELECT
    to_regclass('public.member_profiles')::text AS member_profiles,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid = to_regclass('public.member_profiles')
        AND contype = 'c') AS checks,
    (SELECT count(*)::int FROM pg_indexes
      WHERE tablename = 'member_profiles'
        AND indexname = 'member_profiles_realm_user_key') AS unique_idx,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid = to_regclass('public.member_profiles')
        AND contype = 'f') AS fks
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
  console.log(`  member_profiles: ${row.member_profiles ?? 'absent'}`)
  console.log(`  CHECK constraints: ${row.checks}/3   foreign keys: ${row.fks}/3`)
  console.log(`  unique (realm_id, user_id): ${row.unique_idx === 1 ? 'present' : 'absent'}`)
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

const ok = post.member_profiles !== null && post.checks === 3 && post.unique_idx === 1 && post.fks === 3
console.log(ok ? '\nApplied.' : '\nApplied, but the post-flight probe does not match — inspect before proceeding.')
await pool.end()
process.exit(ok ? 0 : 1)
