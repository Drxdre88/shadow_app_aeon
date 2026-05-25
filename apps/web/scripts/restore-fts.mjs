#!/usr/bin/env node
// Restores the memories.fts generated column + GIN index after drizzle-kit
// push removed them (push doesn't know about manual generated columns from
// migration files). Idempotent — IF NOT EXISTS on everything.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const statements = [
  `ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "fts" tsvector
     GENERATED ALWAYS AS (
       setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
       setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
       setweight(to_tsvector('english', coalesce("body_md", '')), 'C')
     ) STORED`,
  `CREATE INDEX IF NOT EXISTS "memories_fts_idx" ON "memories" USING GIN ("fts")`,
  `CREATE INDEX IF NOT EXISTS "memories_tags_idx" ON "memories" USING GIN ("tags" jsonb_path_ops)`,
]

for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 80))
  } catch (err) {
    console.error('FAIL:', stmt.split('\n')[0].slice(0, 80), err.message)
  }
}
