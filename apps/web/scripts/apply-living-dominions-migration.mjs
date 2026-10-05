#!/usr/bin/env node
// One-off — applies drizzle/0040_living_dominions.sql via raw SQL because the
// drizzle journal is frozen. Additive and idempotent (IF NOT EXISTS / ON
// CONFLICT DO NOTHING), so a re-run is a no-op. Mirrors
// apply-memory-engine-migration.mjs.

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
const file = join(here, '..', 'drizzle', '0040_living_dominions.sql')

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
    to_regclass('public.dominion_members')::text AS dominion_members,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'dominions' AND column_name IN
      ('activity_score', 'last_active_at', 'activity_scored_at', 'activity', 'focus_state', 'pinned')) AS new_columns,
    (SELECT count(*)::int FROM dominion_members) AS members
`
console.log('\nverify:', check)
process.exit(check.dominion_members && check.new_columns === 6 ? 0 : 1)
