#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 — Block A1 — memory.stream_class column + backfill.
//
// Self-contained: creates the `stream_class` column (if missing) and the
// index, then reclassifies existing rows from default 'idea' into the
// three-layer model:
//
//   reflection  type = 'reflection'
//   agentic     source ∈ {claude, agent_session}
//   execution   board/project import + cron + system events
//   idea        everything else (column default — no UPDATE needed)
//
// Idempotent — every step uses IF NOT EXISTS / re-asserts the same value.
//
// Usage:
//   node apps/web/scripts/kairos-memory-streamclass-backfill.mjs           # apply
//   node apps/web/scripts/kairos-memory-streamclass-backfill.mjs --dry-run # counts only, no writes
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing from .env.local')
  process.exit(1)
}

neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const DRY = process.argv.includes('--dry-run')

const SCHEMA_STEPS = [
  {
    label: 'add column stream_class',
    sql: `ALTER TABLE memories ADD COLUMN IF NOT EXISTS stream_class varchar(20) NOT NULL DEFAULT 'idea'`,
  },
  {
    label: 'create index memories_stream_class_idx',
    sql: `CREATE INDEX IF NOT EXISTS memories_stream_class_idx ON memories (user_id, stream_class)`,
  },
]

const BACKFILL_RULES = [
  {
    label: 'reflection',
    countSql: `SELECT COUNT(*)::int AS n FROM memories WHERE type = 'reflection' AND stream_class <> 'reflection'`,
    updateSql: `UPDATE memories SET stream_class = 'reflection' WHERE type = 'reflection' AND stream_class <> 'reflection'`,
  },
  {
    label: 'agentic',
    countSql: `SELECT COUNT(*)::int AS n FROM memories WHERE source IN ('claude','agent_session') AND stream_class = 'idea'`,
    updateSql: `UPDATE memories SET stream_class = 'agentic'  WHERE source IN ('claude','agent_session') AND stream_class = 'idea'`,
  },
  {
    label: 'execution',
    countSql: `
      SELECT COUNT(*)::int AS n FROM memories
       WHERE (
              (source = 'import' AND source_metadata->>'kind' = 'board_task_backfill')
           OR  source = 'cron'
           OR (source = 'system' AND source_metadata->>'kind' IN ('board_action','project_event'))
             )
         AND stream_class = 'idea'`,
    updateSql: `
      UPDATE memories SET stream_class = 'execution'
       WHERE (
              (source = 'import' AND source_metadata->>'kind' = 'board_task_backfill')
           OR  source = 'cron'
           OR (source = 'system' AND source_metadata->>'kind' IN ('board_action','project_event'))
             )
         AND stream_class = 'idea'`,
  },
]

async function columnExists() {
  const { rows } = await pool.query(`
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'memories' AND column_name = 'stream_class'`)
  return rows.length > 0
}

async function main() {
  console.log(`[${new Date().toISOString()}] Kairos A1 stream_class ${DRY ? 'DRY-RUN' : 'APPLY'}`)

  for (const step of SCHEMA_STEPS) {
    if (DRY) {
      console.log(`  [skip] ${step.label}`)
      continue
    }
    console.log(`  [run]  ${step.label}`)
    await pool.query(step.sql)
  }

  if (DRY && !(await columnExists())) {
    console.log('stream_class column does not exist yet — dry-run cannot count candidates. Run without --dry-run to apply.')
    await pool.end()
    return
  }

  const before = await pool.query(`
    SELECT stream_class, COUNT(*)::int AS n
      FROM memories
     GROUP BY stream_class
     ORDER BY stream_class`)
  console.log('Before:')
  for (const r of before.rows) console.log(`  ${String(r.stream_class).padEnd(12)} ${r.n}`)

  for (const rule of BACKFILL_RULES) {
    const { rows } = await pool.query(rule.countSql)
    const n = rows[0]?.n ?? 0
    console.log(`  ${rule.label.padEnd(12)} candidates: ${n}`)
    if (!DRY && n > 0) await pool.query(rule.updateSql)
  }

  const after = await pool.query(`
    SELECT stream_class, COUNT(*)::int AS n
      FROM memories
     GROUP BY stream_class
     ORDER BY stream_class`)
  console.log(DRY ? 'After (would be):' : 'After:')
  for (const r of after.rows) console.log(`  ${String(r.stream_class).padEnd(12)} ${r.n}`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
