#!/usr/bin/env node
// One-off — applies drizzle/0026_favorite_projects.sql via raw SQL because the
// drizzle journal is frozen and drizzle-kit push diffs unrelated manual objects.
// Mirrors apply-oauth-migration.mjs.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS favorite_projects (
     user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     created_at timestamp NOT NULL DEFAULT now(),
     CONSTRAINT favorite_projects_user_id_project_id_pk PRIMARY KEY (user_id, project_id)
   )`,
]

for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 80))
  } catch (err) {
    console.error('FAIL:', stmt.split('\n')[0].slice(0, 80), err.message)
  }
}
