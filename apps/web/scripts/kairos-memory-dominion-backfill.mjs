#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 — Block A2 — memory.dominion_id cascade backfill.
//
// Run AFTER kairos-dominion-seed.mjs (which assigns project.dominion_id and
// populates dominion_repos). Cascade order:
//
//   1. memory.project_id → project.dominion_id          (highest confidence)
//   2. memory.source_metadata->>'repo' → dominion_repos (medium confidence)
//   3. otherwise NULL (orphan — will be caught by A3 prune)
//
// Idempotent — only updates rows still at NULL.
//
// Usage:
//   node apps/web/scripts/kairos-memory-dominion-backfill.mjs --dry-run
//   node apps/web/scripts/kairos-memory-dominion-backfill.mjs
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

const CASCADE = [
  {
    label: 'via project.dominion_id',
    countSql: `
      SELECT COUNT(*)::int AS n FROM memories m
        JOIN projects p ON p.id = m.project_id
       WHERE m.dominion_id IS NULL AND p.dominion_id IS NOT NULL`,
    updateSql: `
      UPDATE memories m
         SET dominion_id = p.dominion_id, updated_at = NOW()
        FROM projects p
       WHERE p.id = m.project_id
         AND m.dominion_id IS NULL
         AND p.dominion_id IS NOT NULL`,
  },
  {
    label: 'via source_metadata.repo',
    countSql: `
      SELECT COUNT(*)::int AS n FROM memories m
        JOIN dominion_repos dr ON dr.repo_slug = m.source_metadata->>'repo'
        JOIN dominions d ON d.id = dr.dominion_id AND d.user_id = m.user_id
       WHERE m.dominion_id IS NULL`,
    updateSql: `
      UPDATE memories m
         SET dominion_id = dr.dominion_id, updated_at = NOW()
        FROM dominion_repos dr
        JOIN dominions d ON d.id = dr.dominion_id
       WHERE dr.repo_slug = m.source_metadata->>'repo'
         AND d.user_id = m.user_id
         AND m.dominion_id IS NULL`,
  },
]

async function snapshot() {
  const r = await pool.query(`
    SELECT COALESCE(d.name, '(unassigned)') AS dominion,
           COUNT(*)::int AS n
      FROM memories m
      LEFT JOIN dominions d ON d.id = m.dominion_id
     GROUP BY d.name
     ORDER BY n DESC`)
  return r.rows
}

function printSnapshot(label, rows) {
  console.log(label)
  for (const r of rows) console.log(`  ${String(r.dominion).padEnd(22)} ${r.n}`)
}

async function main() {
  console.log(`[${new Date().toISOString()}] Kairos A2 memory.dominion_id ${DRY ? 'DRY-RUN' : 'APPLY'}`)
  printSnapshot('Before:', await snapshot())

  for (const step of CASCADE) {
    const { rows } = await pool.query(step.countSql)
    const n = rows[0]?.n ?? 0
    console.log(`  ${step.label.padEnd(24)} candidates: ${n}`)
    if (!DRY && n > 0) await pool.query(step.updateSql)
  }

  printSnapshot(DRY ? 'After (would be):' : 'After:', await snapshot())
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
