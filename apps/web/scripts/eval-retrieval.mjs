#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Vorath / Kairos Brain — retrieval evaluation harness (read-only, GET only).
//
// Scores labelled owner questions (eval/retrieval-fixtures.json) against every
// REST retrieval path and prints recall@5, recall@10, MRR, hit@1 per path and
// per category, plus the abstention pass rate.
//
// Paths:
//   search         GET /api/v1/memories/search?q=      (search_memories REST twin, FTS)
//   context        GET /api/v1/memories/context?query= (prepare_context; FTS+vector RRF, pinned, 1-hop graph)
//   context-nopin  same with includePinned=false&includeToday=false (pure query-driven ranking)
//   Chat retrieval (retrieveForChatGlobal) has no REST route, so it is not measured here.
//
// Ranking: a path's ranked list is the ids in the order the endpoint returns them
// (search hits; context sources = relevant → pinned → related since the 09/10 ordering change;
// earlier saved runs were pinned → relevant → related).
// Abstention rule: an abstention question passes on a path when the path returns
// ZERO query-driven results in its top 10 (search hits; context sources excluding
// the user's pinned memories, which prepare_context injects into every answer).
// Knowledge-update questions also report staleAbove: a mustNotId ranked above the
// first relevant id in the top 10.
//
// Usage (from apps/web):
//   npm run eval:retrieval                               # markdown report to stdout
//   npm run eval:retrieval -- --json > eval/out.json     # full JSON (per-question ranks)
//   node scripts/eval-retrieval.mjs --paths search,context --only ku01,tm03 --delay 400
//   node scripts/eval-retrieval.mjs --out eval/run.json      # save JSON; later: --render eval/run.json (offline)
//   node scripts/eval-retrieval.mjs --help
//
// Env: AEON_API_KEY (falls back to apps/web/.env.local; never printed),
//      AEON_BASE_URL (falls back to .env.local, then https://aeon.shadow-lab.ai).
// Rate: sequential with --delay ms between calls (default 350 ≈ 170/min, under the 200 reads/min limit).
// Labelling/verification helper: scripts/eval-probe.mjs (verify fixture ids before trusting a score).
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { ReadOnlyClient, resolveConfig, makePaths } from './eval-http.mjs'
import { scoreQuestion, aggregate, aggregateByCategory, CATEGORIES } from './eval-metrics.mjs'
import { renderMarkdown } from './eval-report.mjs'

const HELP = `Usage: node scripts/eval-retrieval.mjs [options]

Read-only retrieval eval over eval/retrieval-fixtures.json (40 labelled owner questions).

Options:
  --paths <list>       comma list of: search, context, context-nopin   (default: all)
  --only <ids>         comma list of fixture ids to run (e.g. ku01,tm03)
  --budget <n>         context budgetTokens (default 4000)
  --maxSources <n>     context maxSources (default 15)
  --delay <ms>         pause between HTTP calls (default 350)
  --fixtures <path>    alternative fixtures file
  --json               print JSON (config, per-question results, aggregates) instead of markdown
  --out <file>         also write the JSON report to <file> (e.g. eval/baseline-0910.json)
  --render <file>      re-render markdown from a saved JSON report (no network)
  --help                this text

Metrics per path and per category: recall@5, recall@10, MRR, hit@1 (also hit@5, hit@10).
Abstention passes when a path returns no query-driven results (pinned context excluded).
Env: AEON_API_KEY, AEON_BASE_URL (both fall back to apps/web/.env.local).`

function parseArgs(argv) {
  const get = (name, def) => {
    const i = argv.indexOf(`--${name}`)
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : def
  }
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    paths: get('paths', 'search,context,context-nopin').split(',').map((s) => s.trim()).filter(Boolean),
    only: get('only', '').split(',').map((s) => s.trim()).filter(Boolean),
    budget: Number(get('budget', '4000')),
    maxSources: Number(get('maxSources', '15')),
    delay: Number(get('delay', '350')),
    out: get('out', ''),
    render: get('render', ''),
    fixtures: get('fixtures', resolve(dirname(fileURLToPath(import.meta.url)), '../eval/retrieval-fixtures.json')),
  }
}

function loadFixtures(path, only) {
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const all = data.fixtures ?? []
  const bad = all.filter((f) => !f.id || !CATEGORIES.includes(f.category) || !f.query)
  if (bad.length) throw new Error(`invalid fixtures: ${bad.map((f) => f.id ?? f.query).join(', ')}`)
  return only.length ? all.filter((f) => only.includes(f.id)) : all
}

async function runPath(name, fn, fixtures, log, alwaysOn = new Set()) {
  const rows = []
  for (const f of fixtures) {
    const base = { id: f.id, category: f.category, query: f.query, relevantIds: f.relevantIds ?? [] }
    try {
      const results = await fn(f.query)
      const ranked = results.map((r) => r.id)
      const candidates = results.filter((r) => r.section !== 'pinned' && !alwaysOn.has(r.id)).map((r) => r.id)
      rows.push({ ...base, ranked, top: results.slice(0, 10), score: scoreQuestion(f, ranked, candidates) })
    } catch (err) {
      rows.push({ ...base, ranked: [], error: err.message, score: null })
    }
    log(`  ${name} ${f.id} ${rows.at(-1).error ? 'ERROR' : 'ok'}`)
  }
  return { path: name, rows, overall: aggregate(rows), byCategory: aggregateByCategory(rows) }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    process.stdout.write(HELP + '\n')
    return
  }
  const fixtures = loadFixtures(opts.fixtures, opts.only)
  if (opts.render) {
    process.stdout.write(renderMarkdown(JSON.parse(readFileSync(opts.render, 'utf8')), fixtures) + '\n')
    return
  }
  const cfg = resolveConfig()
  if (!cfg.apiKey) {
    process.stderr.write('ERROR: AEON_API_KEY missing (env or apps/web/.env.local).\n')
    process.exit(1)
  }
  const client = new ReadOnlyClient({ ...cfg, delayMs: opts.delay })
  const available = makePaths(client, { k: 10, budget: opts.budget, maxSources: opts.maxSources })
  const unknown = opts.paths.filter((p) => !available[p])
  if (unknown.length) throw new Error(`unknown path(s): ${unknown.join(', ')}`)

  const log = (s) => process.stderr.write(s + '\n')
  const started = new Date().toISOString()
  const pinned = opts.paths.some((p) => p.startsWith('context')) ? await client.pinnedIds() : new Set()
  const relevantPinned = [...new Set(fixtures.flatMap((f) => f.relevantIds ?? []))].filter((id) => pinned.has(id))
  const paths = []
  for (const p of opts.paths) {
    paths.push(await runPath(p, available[p], fixtures, log, p === 'context' ? pinned : new Set()))
  }

  const report = {
    config: {
      baseUrl: cfg.baseUrl, started, budget: opts.budget, maxSources: opts.maxSources, questions: fixtures.length,
      calls: client.calls, pinnedCount: pinned.size, relevantPinned,
    },
    paths,
  }
  if (opts.out) {
    writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n')
    log(`JSON written to ${opts.out}`)
  }
  process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : renderMarkdown(report, fixtures) + '\n')
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`)
  process.exit(1)
})
