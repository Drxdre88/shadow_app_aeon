#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Brain — embedding backfill driver.
//
// Drives the embedding backfill cron endpoint in a loop until every memory
// in the brain is embedded:
//
//   GET {BASE_URL}/api/cron/embed-backfill?limit=N
//   Auth: authorization: Bearer ${CRON_SECRET}
//   → { model, embedded, remaining, ... }            on success
//   → { error: 'embeddings_disabled' }  (status 200) when no key configured
//   → { error: 'unauthorized' }         (status 401) on bad/missing secret
//
// Cross-platform: pure Node 18+ (built-in fetch, no extra deps).
// Fail-safe: never throws uncaught. Exits 0 on success / clean stop, and
// non-zero ONLY on an auth or config error (bad secret, disabled embeddings).
//
// Usage:
//   CRON_SECRET=... node scripts/backfill-embeddings.mjs
//   CRON_SECRET=... node scripts/backfill-embeddings.mjs --limit 100 --base https://aeon.app
//   CRON_SECRET=... node scripts/backfill-embeddings.mjs --dry-run
//
// Required env: CRON_SECRET
// Optional env: AEON_BASE_URL        (default http://localhost:3000)
//               BACKFILL_LIMIT       (default 200)   rows per batch
//               BACKFILL_MAX_BATCHES (default 1000)  safety cap on iterations
//               BACKFILL_DELAY_MS    (default 300)   pause between batches
//
// Flags:
//   --dry-run        one batch with limit=1, prints the raw response, no loop
//   --limit N        override rows per batch
//   --base URL       override the server base URL
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ─── env loading ──────────────────────────────────────────────────────────
// Auto-load .env.local from this repo so the user doesn't need to export
// CRON_SECRET / AEON_BASE_URL in their shell profile.
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

// ─── CLI flags ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : def
}
const DRY_RUN = args.includes('--dry-run')

// ─── config ────────────────────────────────────────────────────────────────

const CRON_SECRET = process.env.CRON_SECRET
const BASE_URL = (flag('base', process.env.AEON_BASE_URL || 'http://localhost:3000')).replace(/\/+$/, '')
const LIMIT = parseInt(flag('limit', process.env.BACKFILL_LIMIT ?? '200'), 10) || 200
const MAX_BATCHES = parseInt(process.env.BACKFILL_MAX_BATCHES ?? '1000', 10) || 1000
const DELAY_MS = parseInt(process.env.BACKFILL_DELAY_MS ?? '300', 10)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET env var is required (set it in your shell or apps/web/.env.local).')
  process.exit(1)
}

// ─── single batch call ───────────────────────────────────────────────────────
// Returns { ok, status, json } — never throws. status 0 means a network error.
async function callBatch(limit) {
  const url = new URL('/api/cron/embed-backfill', BASE_URL)
  url.searchParams.set('limit', String(limit))
  try {
    const res = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(60_000),
    })
    let json = null
    try {
      json = await res.json()
    } catch {
      // Non-JSON body (e.g. an HTML error page). Leave json null.
    }
    return { ok: res.ok, status: res.status, json }
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err.message }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.error(`Embedding backfill → ${BASE_URL}`)

  // ── dry run: one batch with limit=1, print the raw response, stop ──────────
  if (DRY_RUN) {
    console.error('Dry run: one batch with limit=1.')
    const { ok, status, json, error } = await callBatch(1)
    if (status === 0) {
      console.error(`Network error: ${error}`)
      console.error(`Could not reach ${BASE_URL}. Is the server running and AEON_BASE_URL correct?`)
      process.exit(1)
    }
    console.error(`HTTP ${status}`)
    console.error('Raw response:')
    console.error(JSON.stringify(json, null, 2))
    if (status === 401 || json?.error === 'unauthorized') process.exit(1)
    if (json?.error === 'embeddings_disabled') process.exit(1)
    if (!ok) process.exit(1)
    process.exit(0)
  }

  // ── loop ────────────────────────────────────────────────────────────────
  console.error(`limit=${LIMIT} per batch, max ${MAX_BATCHES} batches, ${DELAY_MS}ms between batches.`)

  let totalEmbedded = 0
  let zeroStreak = 0
  let batch = 0
  let model = null
  let stopReason = 'batch cap hit'

  for (batch = 1; batch <= MAX_BATCHES; batch++) {
    const { ok, status, json, error } = await callBatch(LIMIT)

    // Network error — clean stop, but not an auth/config failure.
    if (status === 0) {
      console.error(`batch ${batch}: network error — ${error}`)
      console.error(`Could not reach ${BASE_URL}. Is the server running and AEON_BASE_URL correct?`)
      stopReason = 'network error'
      break
    }

    // Auth failure — hard config error, exit non-zero.
    if (status === 401 || json?.error === 'unauthorized') {
      console.error('ERROR: 401 unauthorized — CRON_SECRET is missing or does not match the server.')
      process.exit(2)
    }

    // No embedding provider configured server-side — clean stop, exit non-zero
    // (nothing was or can be done until a key is set).
    if (json?.error === 'embeddings_disabled') {
      console.error('No embedding key configured — set VOYAGE_API_KEY or OPENAI_API_KEY on the server first.')
      process.exit(3)
    }

    // Any other non-OK response, or a missing body — report and stop the loop.
    if (!ok || !json || typeof json.remaining !== 'number') {
      console.error(`batch ${batch}: unexpected response (HTTP ${status}): ${JSON.stringify(json)?.slice(0, 300)}`)
      stopReason = 'unexpected response'
      break
    }

    const embedded = Number(json.embedded) || 0
    const remaining = Number(json.remaining) || 0
    if (json.model) model = json.model
    totalEmbedded += embedded

    console.error(`batch ${batch}: embedded ${embedded}, remaining ${remaining}`)

    if (remaining <= 0) {
      stopReason = 'all embedded'
      break
    }

    // No-progress guard: if two consecutive batches embed nothing while rows
    // still remain, the server can't make progress (e.g. all remaining rows
    // error on embed) — stop instead of spinning to the batch cap.
    if (embedded === 0) {
      zeroStreak++
      if (zeroStreak >= 2) {
        stopReason = 'no progress (0 embedded twice in a row)'
        break
      }
    } else {
      zeroStreak = 0
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS)
  }

  // ── summary ──────────────────────────────────────────────────────────────
  console.error('')
  console.error('─'.repeat(60))
  console.error(`Done: ${stopReason}.`)
  console.error(`Total embedded this run: ${totalEmbedded} over ${batch > MAX_BATCHES ? MAX_BATCHES : batch} batch(es).`)
  if (model) console.error(`Model: ${model}`)
  process.exit(0)
}

main().catch((err) => {
  console.error(`unhandled: ${err.message}`)
  // Unexpected crash is not an auth/config error — exit 0 per fail-safe contract.
  process.exit(0)
})
