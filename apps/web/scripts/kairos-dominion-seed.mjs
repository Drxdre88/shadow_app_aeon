#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 — Block A2 — Dominion taxonomy seeder + project/repo mapping.
//
// Owner-approved taxonomy (8 Dominions). Idempotent:
//   - Creates each Dominion by (user_id, name) — re-runs touch updatedAt only.
//   - Sets project.dominion_id for every mapped project name.
//   - Inserts (dominion_id, repo_slug) into dominion_repos, ON CONFLICT DO NOTHING.
//   - Leaves the existing AEON Dominion intact, just updates its icon if missing.
//
// Run sequence:
//   node apps/web/scripts/kairos-dominion-seed.mjs --dry-run
//   node apps/web/scripts/kairos-dominion-seed.mjs
//
// After this lands, re-run the streamclass-backfill or the dedicated A2 cascade
// to fill memory.dominion_id from project.dominion_id + dominion_repos.
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

// Owner's user id pulled at runtime via the existing single-owner identity.
// If multiple users exist this picks the AEON owner (most-active user).
async function resolveOwnerId() {
  const { rows } = await pool.query(`
    SELECT user_id, COUNT(*)::int AS n
      FROM projects
     GROUP BY user_id
     ORDER BY n DESC
     LIMIT 1`)
  if (!rows.length) throw new Error('No projects found — cannot resolve owner')
  return rows[0].user_id
}

const TAXONOMY = [
  {
    name: 'AEON',
    color: 'amber',
    icon: 'hourglass',
    sortOrder: 0,
    vision: 'Application Development of AEON, Kairos to transform Agentic Engineering into AI Driven full scale second brain',
    missionLong: 'Building out the AEON APP',
    projects: ['AEON APP', 'AEON Beta Testing', 'AEON Closed Beta: PBIs', 'Claude Code', 'Age of AI: L&L'],
    repos: ['shadow_app_aeon'],
  },
  {
    name: 'Swarm',
    color: 'purple',
    icon: 'satellite',
    sortOrder: 1,
    vision: 'Opportunity engine — sweep parameter variations, backtest, rank, promote.',
    missionLong: 'Build Swarm as the second flagship product after AEON.',
    projects: ['SWARM APP', 'Swarm Vision'],
    repos: ['shadow_app_swarm'],
  },
  {
    name: 'Shadow Lab',
    color: 'emerald',
    icon: 'flask',
    sortOrder: 2,
    vision: 'The lab where everything starts — research infra, data, experimentation.',
    missionLong: 'Maintain a strong foundation of data, ML, and dev tooling that feeds every product line.',
    projects: ['Shadow Data Lab', 'Shadow Dev Lab', 'Shadow Dag Lab', 'Arcane ML Lab', 'MVV File Automation', 'papers'],
    repos: ['shadow_data_lab', 'shadow_dev_lab', 'shadow_dag_lab', 'shadow_ml_lab'],
  },
  {
    name: 'Shadow Apps',
    color: 'sky',
    icon: 'cpu',
    sortOrder: 3,
    vision: 'Constellation of product experiments — graduating apps move out, dormant apps stay.',
    missionLong: 'Park promising side-product experiments here until they prove themselves into their own Dominion.',
    projects: ['KAL EL APP', 'HYDRA APP', 'VULCAN APP', 'VISOR APP', 'RIFT APP', 'ARQ APP'],
    repos: ['shadow_app_visor', 'shadow_app_arq', 'shadow_app_antares', 'shadow_app_hydra'],
  },
  {
    name: 'STP Asset Trading',
    color: 'red',
    icon: 'factory',
    sortOrder: 4,
    vision: 'The book — live capital deployment and named strategies in production.',
    missionLong: 'Run and evolve the active trading book.',
    projects: ['AS Sprint', 'AS Vault', 'Germany Intraday', 'mr dubai', 'Ragnar'],
    repos: [],
  },
  {
    name: 'STP Spec',
    color: 'rose',
    icon: 'banknote',
    sortOrder: 5,
    vision: 'Where strategy ideas are born — speculative research, leads, candidate alphas.',
    missionLong: 'Generate and triage trading strategy ideas before they enter the quant pipeline.',
    projects: ['STP Strats', 'STP Leads', 'STP Trading Brain'],
    repos: [],
  },
  {
    name: 'STP Quant',
    color: 'orange',
    icon: 'network',
    sortOrder: 6,
    vision: 'The numbers underneath — analysis, data, statistical validation.',
    missionLong: 'Turn raw market data into validated edge.',
    projects: ['STP Analysis', 'Data Initiative'],
    repos: [],
  },
  {
    name: 'STP Dev',
    color: 'yellow',
    icon: 'truck',
    sortOrder: 7,
    vision: 'Engineering and operations under the trading desk.',
    missionLong: 'Keep the trading infra running and the sprints shipping.',
    projects: ['STP Sprint', 'STP Q2-26', 'STP Roadmap', 'STP Dev Ops'],
    repos: [],
  },
]

async function upsertDominion(userId, d) {
  const existing = await pool.query(
    `SELECT id, icon, color, sort_order FROM dominions WHERE user_id = $1 AND name = $2 LIMIT 1`,
    [userId, d.name],
  )
  if (existing.rows.length) {
    const row = existing.rows[0]
    if (DRY) {
      console.log(`  [skip] ${d.name.padEnd(22)} exists (id=${row.id.slice(0, 8)})`)
      return { id: row.id, created: false }
    }
    // Backfill icon / color if missing, leave existing vision/mission alone.
    await pool.query(
      `UPDATE dominions
          SET icon       = COALESCE(NULLIF(icon, ''), $1),
              color      = COALESCE(NULLIF(color, ''), $2),
              sort_order = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [d.icon, d.color, d.sortOrder, row.id],
    )
    console.log(`  [upd]  ${d.name.padEnd(22)} id=${row.id.slice(0, 8)} icon→${d.icon} color→${d.color}`)
    return { id: row.id, created: false }
  }
  if (DRY) {
    console.log(`  [plan] ${d.name.padEnd(22)} CREATE icon=${d.icon} color=${d.color}`)
    return { id: null, created: true }
  }
  const { rows } = await pool.query(
    `INSERT INTO dominions (user_id, name, color, icon, sort_order, vision, mission_long)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, d.name, d.color, d.icon, d.sortOrder, d.vision, d.missionLong],
  )
  console.log(`  [new]  ${d.name.padEnd(22)} id=${rows[0].id.slice(0, 8)} icon=${d.icon}`)
  return { id: rows[0].id, created: true }
}

async function assignProjects(userId, dominionId, projectNames) {
  if (!projectNames.length) return { matched: 0, updated: 0 }
  const matched = await pool.query(
    `SELECT id, name, dominion_id FROM projects WHERE user_id = $1 AND name = ANY($2::text[])`,
    [userId, projectNames],
  )
  if (DRY) {
    for (const r of matched.rows) {
      const mark = r.dominion_id === dominionId ? '=' : r.dominion_id ? '!' : '+'
      console.log(`        ${mark} ${r.name}`)
    }
    return { matched: matched.rows.length, updated: 0 }
  }
  let updated = 0
  for (const row of matched.rows) {
    if (row.dominion_id === dominionId) continue
    await pool.query(`UPDATE projects SET dominion_id = $1, updated_at = NOW() WHERE id = $2`, [dominionId, row.id])
    updated++
  }
  return { matched: matched.rows.length, updated }
}

async function bindRepos(dominionId, repos) {
  if (!repos.length) return 0
  if (DRY) {
    for (const r of repos) console.log(`        repo: ${r}`)
    return repos.length
  }
  let inserted = 0
  for (const r of repos) {
    const res = await pool.query(
      `INSERT INTO dominion_repos (dominion_id, repo_slug)
       VALUES ($1, $2)
       ON CONFLICT (dominion_id, repo_slug) DO NOTHING
       RETURNING dominion_id`,
      [dominionId, r],
    )
    if (res.rowCount > 0) inserted++
  }
  return inserted
}

async function main() {
  console.log(`[${new Date().toISOString()}] Kairos A2 seeder ${DRY ? 'DRY-RUN' : 'APPLY'}`)
  const ownerId = await resolveOwnerId()
  console.log(`owner user_id: ${ownerId}\n`)

  let totalProjectsMatched = 0
  let totalProjectsUpdated = 0
  let totalReposBound = 0

  for (const d of TAXONOMY) {
    const { id } = await upsertDominion(ownerId, d)
    if (!id && DRY) {
      // Dry-run create — can't bind without an id, just preview the bindings.
      if (d.projects.length) {
        const found = await pool.query(
          `SELECT name FROM projects WHERE user_id = $1 AND name = ANY($2::text[])`,
          [ownerId, d.projects],
        )
        for (const r of found.rows) console.log(`        + ${r.name}`)
      }
      for (const r of d.repos) console.log(`        repo: ${r}`)
      continue
    }
    const { matched, updated } = await assignProjects(ownerId, id, d.projects)
    const reposBound = await bindRepos(id, d.repos)
    totalProjectsMatched += matched
    totalProjectsUpdated += updated
    totalReposBound += reposBound
    if (!DRY) {
      console.log(`        projects matched=${matched} updated=${updated} repos+${reposBound}`)
    }
  }

  console.log(`\nsummary: projects matched=${totalProjectsMatched} updated=${totalProjectsUpdated} repos bound=${totalReposBound}`)

  // Surface still-unassigned projects so we can decide later.
  const orphans = await pool.query(
    `SELECT name FROM projects WHERE user_id = $1 AND dominion_id IS NULL ORDER BY name`,
    [ownerId],
  )
  if (orphans.rows.length) {
    console.log(`\nprojects still without dominion (${orphans.rows.length}):`)
    for (const r of orphans.rows) console.log(`  - ${r.name}`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
