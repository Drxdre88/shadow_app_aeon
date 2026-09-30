#!/usr/bin/env node
// One-off — applies drizzle/0039_kairos_memory_engine.sql via raw SQL because
// the drizzle journal is frozen. Additive and idempotent (IF NOT EXISTS), so a
// re-run is a no-op. Mirrors apply-one-live-mission-migration.mjs.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)
const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, '..', 'drizzle', '0039_kairos_memory_engine.sql')

const statements = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

for (const statement of statements) {
  try {
    await sql(statement)
    console.log('OK:', statement.split('\n')[0].slice(0, 90))
  } catch (err) {
    console.error('FAIL:', statement.split('\n')[0].slice(0, 90), '\n ', err.message)
    process.exit(1)
  }
}

const [check] = await sql`
  SELECT
    to_regclass('public.memory_ops')::text AS memory_ops,
    to_regclass('public.thinking_jobs')::text AS thinking_jobs,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'memories' AND column_name IN ('standing', 'standing_at', 'last_used_at', 'use_count')) AS new_columns
`
console.log('\nverify:', check)
process.exit(check.memory_ops && check.thinking_jobs && check.new_columns === 4 ? 0 : 1)
