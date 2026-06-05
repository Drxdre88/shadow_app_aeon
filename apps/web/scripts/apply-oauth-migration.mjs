#!/usr/bin/env node
// One-off — applies drizzle/0022_oauth.sql via raw SQL because drizzle-kit
// push wants to drop memories.fts (a manual generated column not modelled in
// schema.ts) and that's unrelated to this change. Mirrors apply-task-assignees.mjs.

import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL not set'); process.exit(1) }

const sql = neon(url)

const statements = [
  `CREATE TABLE IF NOT EXISTS oauth_clients (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     client_name   varchar(255),
     redirect_uris jsonb NOT NULL,
     created_at    timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS oauth_auth_codes (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     code_hash      varchar(64) NOT NULL UNIQUE,
     client_id      uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
     user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     redirect_uri   text NOT NULL,
     code_challenge varchar(128) NOT NULL,
     scope          varchar(255) NOT NULL DEFAULT 'mcp',
     resource       text,
     expires_at     timestamp NOT NULL,
     used_at        timestamp,
     created_at     timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS oauth_access_tokens (
     id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     token_hash         varchar(64) NOT NULL UNIQUE,
     token_prefix       varchar(12) NOT NULL,
     refresh_hash       varchar(64) UNIQUE,
     client_id          uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
     user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     scope              varchar(255) NOT NULL DEFAULT 'mcp',
     expires_at         timestamp NOT NULL,
     refresh_expires_at timestamp,
     revoked_at         timestamp,
     last_used_at       timestamp,
     created_at         timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_idx
     ON oauth_access_tokens (user_id)`,
]

for (const stmt of statements) {
  try {
    await sql(stmt)
    console.log('OK:', stmt.split('\n')[0].slice(0, 80))
  } catch (err) {
    console.error('FAIL:', stmt.split('\n')[0].slice(0, 80), err.message)
  }
}
