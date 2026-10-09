#!/usr/bin/env node
// Apply one hand-written migration to the database in DATABASE_URL — the one
// sanctioned way to change the schema now that deploys no longer push it.
// Agents may run it without an approval step (owner, 09/10); the guards are
// mechanical instead:
//   - the whole file runs in ONE transaction (all or nothing), unless --no-tx
//     (needed only for CREATE INDEX CONCURRENTLY and similar);
//   - destructive statements (DROP TABLE/COLUMN/SCHEMA, TRUNCATE, DELETE FROM)
//     are refused unless --allow-destructive is passed;
//   - every applied file is recorded in ops.db_applies (outside the public
//     schema the drift check reads), and the same file content is not applied
//     twice unless --force;
//   - the read-only drift check runs afterwards and prints what still differs.
//
// Usage: npm run db:apply -- drizzle/0042_x.sql [--dry-run] [--allow-destructive] [--no-tx] [--force]

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { neon, Pool } from '@neondatabase/serverless'
import dotenv from 'dotenv'

const DESTRUCTIVE = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+schema\b/i,
  /\balter\s+table\b[^;]*\bdrop\s+(column\b|(?!constraint|default|not\b|index\b)[a-z_"]+)/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
]

/** SQL with -- and /* *\/ comments removed, so commented-out DROPs never count. */
export function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** The destructive statements in a migration, as short excerpts. */
export function findDestructive(sql) {
  const clean = stripComments(sql)
  const hits = []
  for (const statement of clean.split(';')) {
    const text = statement.replace(/\s+/g, ' ').trim()
    if (text && DESTRUCTIVE.some((re) => re.test(text))) hits.push(text.slice(0, 120))
  }
  return hits
}

export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  const file = argv.find((a) => !a.startsWith('--'))
  return {
    file,
    dryRun: flags.has('--dry-run'),
    allowDestructive: flags.has('--allow-destructive'),
    noTx: flags.has('--no-tx'),
    force: flags.has('--force'),
  }
}

const LEDGER_SQL = `
  CREATE SCHEMA IF NOT EXISTS ops;
  CREATE TABLE IF NOT EXISTS ops.db_applies (
    id bigserial PRIMARY KEY,
    file text NOT NULL,
    sha256 text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    applied_by text
  );`

async function main() {
  dotenv.config({ path: '.env.local' })
  dotenv.config({ path: '.env' })
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('Usage: npm run db:apply -- drizzle/<file>.sql [--dry-run] [--allow-destructive] [--no-tx] [--force]')
    return 2
  }
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL not set — nothing applied.'); return 2 }

  const path = resolve(args.file)
  const sql = readFileSync(path, 'utf8')
  const sha = createHash('sha256').update(sql).digest('hex')
  const host = new URL(url).hostname
  console.log(`db:apply ${basename(path)} → ${host}${args.dryRun ? ' (dry run)' : ''}`)

  const destructive = findDestructive(sql)
  if (destructive.length > 0) {
    console.log(`\n${destructive.length} destructive statement(s):`)
    for (const d of destructive) console.log(`  ${d}`)
    if (!args.allowDestructive) {
      console.error('\nRefused: pass --allow-destructive to run these against live data.')
      return 1
    }
  }
  if (args.dryRun) { console.log('\nDry run: nothing applied.'); return 0 }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 20000 })
  const client = await pool.connect()
  try {
    await client.query(LEDGER_SQL)
    const prior = await client.query('SELECT applied_at FROM ops.db_applies WHERE sha256 = $1 ORDER BY applied_at DESC LIMIT 1', [sha])
    if (prior.rows.length > 0 && !args.force) {
      console.log(`\nAlready applied on ${prior.rows[0].applied_at.toISOString()} — skipped (use --force to re-run).`)
      return 0
    }
    if (!args.noTx) await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO ops.db_applies (file, sha256, applied_by) VALUES ($1, $2, $3)', [basename(path), sha, process.env.USERNAME || process.env.USER || null])
      if (!args.noTx) await client.query('COMMIT')
    } catch (err) {
      if (!args.noTx) await client.query('ROLLBACK').catch(() => {})
      console.error(`\nFAILED${args.noTx ? '' : ' — rolled back, nothing changed'}: ${err.message}`)
      return 1
    }
    console.log('\nApplied.')
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }

  const drift = await import('./verify-schema-drift.mjs')
  const http = neon(url, { fullResults: true })
  try {
    const report = drift.compareSchemas(await drift.readDatabaseShape({ query: (text) => http(text) }), await drift.readDeclaredShape())
    console.log(`\n${drift.formatReport(report)}`)
  } catch (err) {
    console.warn(`\nDrift check after apply could not run: ${err.message}`)
  }
  return 0
}

const invokedDirectly = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  let code = 2
  try {
    code = await main()
  } catch (err) {
    console.error(`db:apply failed: ${err?.message ?? err}`)
  }
  // exitCode, not process.exit(): see verify-schema-drift.mjs (Windows crash on forced exit).
  process.exitCode = code
}
