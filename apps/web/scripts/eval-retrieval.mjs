#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kairos Brain — retrieval evaluation harness.
//
// Reads eval/retrieval-fixtures.json, calls the /context endpoint for each
// query, and prints recall@k, precision@k, MRR, and hit-rate.
//
// The server decides FTS-only vs hybrid (embedding) retrieval based on its
// own configuration — this harness measures whatever the server does.
// Run once for keyword baseline, again after embeddings go live, compare.
//
// Usage:
//   AEON_API_KEY=sk-... node scripts/eval-retrieval.mjs
//   AEON_API_KEY=sk-... node scripts/eval-retrieval.mjs --k 5 --budget 2000 --maxSources 10
//   AEON_API_KEY=sk-... node scripts/eval-retrieval.mjs --json > results.json
//
// Required env: AEON_API_KEY
// Optional env: AEON_BASE_URL (default http://localhost:3000)
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

// ── Pure metric functions (duplicated here so harness is self-contained;
//    the canonical source lives in src/lib/kairos/eval-metrics.ts for tests) ──

function recallAtK(retrievedIds, relevantIds, k) {
  if (relevantIds.length === 0) return null // can't score, not 0
  const topK = new Set(retrievedIds.slice(0, k))
  return relevantIds.filter((id) => topK.has(id)).length / relevantIds.length
}

function precisionAtK(retrievedIds, relevantIds, k) {
  const topK = retrievedIds.slice(0, k)
  if (topK.length === 0) return 0
  const rel = new Set(relevantIds)
  return topK.filter((id) => rel.has(id)).length / topK.length
}

function reciprocalRank(retrievedIds, relevantIds) {
  const rel = new Set(relevantIds)
  for (let i = 0; i < retrievedIds.length; i++) {
    if (rel.has(retrievedIds[i])) return 1 / (i + 1)
  }
  return 0
}

function avg(nums) {
  if (nums.length === 0) return 0
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

// ── CLI flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : def
}
const K = parseInt(flag('k', '10'), 10)
const BUDGET = parseInt(flag('budget', '4000'), 10)
const MAX_SOURCES = parseInt(flag('maxSources', '15'), 10)
const JSON_OUTPUT = args.includes('--json')

// ── Config ─────────────────────────────────────────────────────────────────

const API_KEY = process.env.AEON_API_KEY
const BASE_URL = (process.env.AEON_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

if (!API_KEY) {
  console.error('ERROR: AEON_API_KEY env var is required.')
  process.exit(1)
}

// ── Load fixtures ──────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const fixturesPath = resolve(__dir, '../eval/retrieval-fixtures.json')

let fixturesData
try {
  fixturesData = JSON.parse(readFileSync(fixturesPath, 'utf8'))
} catch (err) {
  console.error(`ERROR: Could not read fixtures at ${fixturesPath}: ${err.message}`)
  process.exit(1)
}

const fixtures = fixturesData.fixtures
if (!Array.isArray(fixtures) || fixtures.length === 0) {
  console.error('ERROR: fixtures.json must have a non-empty "fixtures" array.')
  process.exit(1)
}

// ── Retrieval call ─────────────────────────────────────────────────────────

async function fetchContext(query) {
  const url = new URL('/api/v1/memories/context', BASE_URL)
  url.searchParams.set('query', query)
  url.searchParams.set('budgetTokens', String(BUDGET))
  url.searchParams.set('maxSources', String(MAX_SOURCES))
  url.searchParams.set('hops', '1')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json()
}

// ── Main ───────────────────────────────────────────────────────────────────

const results = []
const scored = [] // only fixtures with non-empty relevantIds

for (const fixture of fixtures) {
  const { query, relevantIds = [], note = '' } = fixture

  if (!Array.isArray(relevantIds) || relevantIds.length === 0) {
    if (!JSON_OUTPUT) {
      console.warn(`[SKIP] "${query}" — relevantIds is empty, cannot score. Fill fixtures.`)
    }
    results.push({ query, note, skipped: true, retrieved: [] })
    continue
  }

  let retrieved = []
  let error = null

  try {
    const data = await fetchContext(query)
    retrieved = (data.sources ?? []).map((s) => s.id)
  } catch (err) {
    error = err.message
    if (!JSON_OUTPUT) {
      console.error(`[ERROR] "${query}": ${err.message}`)
    }
    results.push({ query, note, error, retrieved: [], skipped: false })
    continue
  }

  const recall = recallAtK(retrieved, relevantIds, K)
  const precision = precisionAtK(retrieved, relevantIds, K)
  const rr = reciprocalRank(retrieved, relevantIds)
  const hasHit = retrieved.slice(0, K).some((id) => relevantIds.includes(id))

  results.push({
    query,
    note,
    skipped: false,
    retrieved,
    relevantIds,
    recall,
    precision,
    rr,
    hasHit,
    retrievedCount: retrieved.length,
  })
  scored.push({ recall, precision, rr, hasHit })
}

// ── Aggregate ──────────────────────────────────────────────────────────────

const aggregate =
  scored.length === 0
    ? null
    : {
        k: K,
        queries: fixtures.length,
        scored: scored.length,
        recallAtK: avg(scored.map((s) => s.recall ?? 0)),
        precisionAtK: avg(scored.map((s) => s.precision)),
        mrr: avg(scored.map((s) => s.rr)),
        hitRate: scored.filter((s) => s.hasHit).length / scored.length,
      }

// ── Output ─────────────────────────────────────────────────────────────────

if (JSON_OUTPUT) {
  console.log(JSON.stringify({ config: { k: K, budget: BUDGET, maxSources: MAX_SOURCES }, results, aggregate }, null, 2))
  process.exit(0)
}

// Human-readable table
const pct = (v) => (v == null ? '   n/a' : `${(v * 100).toFixed(1).padStart(5)}%`)
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n)

console.log()
console.log(`Kairos Retrieval Eval  (k=${K}, budget=${BUDGET}, maxSources=${MAX_SOURCES})`)
console.log(`Server: ${BASE_URL}`)
console.log()
console.log(
  `${'Query'.padEnd(45)}  ${'Recall'.padStart(7)}  ${'Prec'.padStart(7)}  ${'RR'.padStart(7)}  Hit`,
)
console.log('─'.repeat(75))

for (const r of results) {
  if (r.skipped) {
    console.log(`${pad(r.query, 45)}  [SKIP — no relevantIds]`)
    continue
  }
  if (r.error) {
    console.log(`${pad(r.query, 45)}  [ERROR: ${r.error.slice(0, 30)}]`)
    continue
  }
  console.log(
    `${pad(r.query, 45)}  ${pct(r.recall)}  ${pct(r.precision)}  ${pct(r.rr)}  ${r.hasHit ? 'yes' : ' no'}`,
  )
}

console.log('─'.repeat(75))

if (!aggregate) {
  console.log('No scored queries — populate relevantIds in eval/retrieval-fixtures.json.')
} else {
  console.log(
    `${'AGGREGATE'.padEnd(45)}  ${pct(aggregate.recallAtK)}  ${pct(aggregate.precisionAtK)}  ${pct(aggregate.mrr)}  ${pct(aggregate.hitRate)}`,
  )
  console.log()
  console.log(
    `Scored ${aggregate.scored}/${aggregate.queries} queries.  MRR=${(aggregate.mrr * 100).toFixed(1)}%  Hit-rate=${(aggregate.hitRate * 100).toFixed(1)}%`,
  )
}
console.log()
