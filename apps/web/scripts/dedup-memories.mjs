#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Brain — memory dedup driver.
//
// Calls the dedup cron endpoint once and prints the result:
//   GET {BASE_URL}/api/cron/memory-dedup?dryRun=0&threshold=0.97
//   Auth: authorization: Bearer ${CRON_SECRET}
//   → { clusters, superseded, dryRun }                on success
//   → { error: 'embeddings_disabled' }  (status 200)  when no key configured
//   → { error: 'unauthorized' }         (status 401)  on bad/missing secret
//
// Default is a DRY RUN — pass --apply to actually supersede.
//
// Usage:
//   CRON_SECRET=... node scripts/dedup-memories.mjs --base https://aeon.shadow-lab.ai
//   CRON_SECRET=... node scripts/dedup-memories.mjs --apply --threshold 0.97 --base https://aeon.shadow-lab.ai
//
// Required env: CRON_SECRET
// Optional env: AEON_BASE_URL (default http://localhost:3000)
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
if (existsSync(envPath)) {
  const envSrc = readFileSync(envPath, 'utf8').replace(/\r/g, '')
  for (const rawLine of envSrc.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = val
  }
}

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const base = (opt('--base', process.env.AEON_BASE_URL) || 'http://localhost:3000').replace(/\/$/, '')
const apply = flag('--apply')
const threshold = opt('--threshold', null)
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET is required (env or .env.local).')
  process.exit(1)
}

const url = new URL(`${base}/api/cron/memory-dedup`)
url.searchParams.set('dryRun', apply ? '0' : '1')
if (threshold) url.searchParams.set('threshold', threshold)

console.log(`Memory dedup → ${base}  (${apply ? 'APPLY' : 'dry-run'}${threshold ? `, threshold=${threshold}` : ''})`)

try {
  const res = await fetch(url, { headers: { authorization: `Bearer ${secret}` } })
  const json = await res.json().catch(() => ({}))
  if (res.status === 401) {
    console.error('Unauthorized — CRON_SECRET does not match the deployment.')
    process.exit(2)
  }
  if (json.error === 'embeddings_disabled') {
    console.error('Embeddings disabled — set VOYAGE_API_KEY or OPENAI_API_KEY on the server.')
    process.exit(3)
  }
  console.log(`HTTP ${res.status}`)
  console.log(JSON.stringify(json, null, 2))
  if (!apply && (json.clusters ?? 0) > 0) {
    console.log(`\nDry run: ${json.superseded} rows in ${json.clusters} clusters would be superseded. Re-run with --apply to commit.`)
  }
} catch (err) {
  console.error('Request failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
}
