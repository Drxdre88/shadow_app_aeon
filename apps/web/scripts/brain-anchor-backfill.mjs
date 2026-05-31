#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Aeon Brain — one-shot backfill that wires repo / project / realm anchors
// onto memories that were captured before the per-repo resolution landed.
//
// Strategy:
//   1. List source='claude' memories (paginated).
//   2. For each, derive the repo slug from sourceMetadata.repo (preferred)
//      or sourceMetadata.cwd (fallback).
//   3. Map slug → Aeon project name (same convention as the capture script).
//   4. Hit /api/v1/projects/resolve to get { id, realmId }.
//   5. PATCH the memory with the resolved anchors.
//
// Usage:
//   node apps/web/scripts/brain-anchor-backfill.mjs [--dry-run] [--limit=N]
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}

const BASE_URL = (process.env.AEON_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const API_KEY = process.env.AEON_API_KEY
if (!API_KEY) {
  console.error('AEON_API_KEY missing from .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT = (() => {
  const arg = args.find((a) => a.startsWith('--limit='))
  return arg ? parseInt(arg.slice('--limit='.length), 10) : 500
})()

// Mirror the capture-script convention exactly.
function repoToProjectName(slug) {
  if (!slug) return null
  const s = String(slug).trim()
  const appMatch = s.match(/^shadow_app_(.+)$/)
  if (appMatch) return appMatch[1].toUpperCase() + ' APP'
  if (s.endsWith('_dash')) return s.slice(0, -5).toUpperCase().replace(/_/g, ' ') + ' APP'
  if (s.endsWith('_lab')) {
    return s.split('_').map((w) =>
      w.toLowerCase() === 'ml' ? 'ML' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ')
  }
  return null
}

function repoSlugFromCwd(cwd) {
  if (!cwd) return null
  const norm = String(cwd).replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, '$1:/')
  const m = norm.match(/\/dev_26\/([^/]+)/)
  return m ? m[1] : basename(norm) || null
}

const projectCache = new Map()
let allProjectsCache = null

async function fetchAllProjectsFallback() {
  if (allProjectsCache) return allProjectsCache
  const url = `${BASE_URL}/api/v1/projects?limit=500`
  const res = await fetch(url, { headers: { authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) {
    allProjectsCache = []
    return allProjectsCache
  }
  const parsed = await res.json()
  allProjectsCache = parsed?.data ?? []
  return allProjectsCache
}

async function resolveProject(name) {
  if (!name) return null
  if (projectCache.has(name)) return projectCache.get(name)
  const url = `${BASE_URL}/api/v1/projects/resolve?name=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { authorization: `Bearer ${API_KEY}` } })
  if (res.ok) {
    const parsed = await res.json()
    const data = parsed?.data ?? null
    projectCache.set(name, data)
    return data
  }
  // Fallback for environments where resolve isn't deployed yet: scan the
  // full project list locally. realm info will be missing in this path —
  // the script still patches projectId; realm comes from the project later.
  const all = await fetchAllProjectsFallback()
  const target = name.toLowerCase()
  const match = all.find((p) => p.name.toLowerCase() === target)
  const data = match ? { id: match.id, name: match.name, realmId: null, realmName: null } : null
  projectCache.set(name, data)
  return data
}

async function listClaudeMemories() {
  const out = []
  let offset = 0
  const step = 200
  while (out.length < LIMIT) {
    const url = `${BASE_URL}/api/v1/memories?limit=${step}&offset=${offset}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${API_KEY}` } })
    if (!res.ok) throw new Error(`list failed ${res.status}`)
    const parsed = await res.json()
    const batch = parsed?.data ?? []
    if (batch.length === 0) break
    for (const m of batch) {
      if (m.source === 'claude') out.push(m)
    }
    if (batch.length < step) break
    offset += step
  }
  return out.slice(0, LIMIT)
}

async function patchMemory(memoryId, patch) {
  const url = `${BASE_URL}/api/v1/memories/${memoryId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PATCH ${memoryId} → ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function main() {
  console.log(`brain-anchor-backfill: ${DRY_RUN ? 'DRY RUN — ' : ''}target ${BASE_URL}`)
  const memories = await listClaudeMemories()
  console.log(`found ${memories.length} claude-source memories`)

  let touched = 0
  let skipped = 0
  let unresolved = 0
  for (const mem of memories) {
    const meta = mem.sourceMetadata ?? {}
    const slug = meta.repo || repoSlugFromCwd(meta.cwd)
    if (!slug) {
      skipped++
      continue
    }
    // If already anchored, leave it alone.
    if (mem.projectId) {
      skipped++
      continue
    }
    const projectName = repoToProjectName(slug)
    const projectInfo = projectName ? await resolveProject(projectName) : null
    if (!projectInfo) {
      console.log(`  - ${mem.id.slice(0, 8)}  repo=${slug}  project=${projectName ?? '(none)'}  → no match`)
      unresolved++
      continue
    }
    const patch = {
      projectId: projectInfo.id,
      realmId: projectInfo.realmId ?? mem.realmId ?? null,
    }
    console.log(`  ✓ ${mem.id.slice(0, 8)}  repo=${slug}  →  ${projectInfo.name}  realm=${projectInfo.realmName ?? '∅'}`)
    if (!DRY_RUN) {
      try {
        await patchMemory(mem.id, patch)
        touched++
      } catch (err) {
        console.error(`    PATCH failed: ${err.message}`)
      }
    } else {
      touched++
    }
  }

  console.log(`\nSummary: ${touched} ${DRY_RUN ? 'would-patch' : 'patched'} · ${unresolved} unresolved · ${skipped} skipped (no repo or already anchored)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
