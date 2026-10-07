#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { PathClassifier } from './classify.mjs'
import { loadConfig, repoPath } from './extract.mjs'
import { mapLimit } from './prs.mjs'
import { RepoExtractor, shiftDay } from './repo.mjs'
import { IdentityMatcher } from './summary.mjs'
import { DEFAULT_CATCH_UP, localDayOf, planDays } from './digest-days.mjs'
import { AeonPoster, loadEnvFile } from './digest-post.mjs'
import { DigestPrFetcher, PR_LOOKBACK_DAYS } from './digest-prs.mjs'
import { buildPayload, buildRepoDay } from './digest-stats.mjs'
import { DigestStore } from './digest-store.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const STAT_KEYS = ['commits', 'linesAdded', 'linesRemoved', 'honestAdded', 'honestRemoved', 'codeAdded', 'codeRemoved', 'filesAdded', 'filesModified', 'filesDeleted', 'aiAssistedCommits', 'giantCommits', 'rawAdded', 'rawRemoved']

export const USAGE = `Usage: node digest.mjs [--day YYYY-MM-DD] [--catch-up N] [--dry-run [--store]] [--repos a,b]
  [--no-prs] [--config repos.json] [--lookback-days 60] [--concurrency 4]`

export function parseDigestCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      day: { type: 'string' },
      'catch-up': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      store: { type: 'boolean', default: false },
      repos: { type: 'string' },
      'no-prs': { type: 'boolean', default: false },
      config: { type: 'string', default: join(scriptDir, 'repos.json') },
      'lookback-days': { type: 'string', default: '60' },
      concurrency: { type: 'string', default: '4' },
      help: { type: 'boolean', default: false },
    },
  })
  const int = (text, name, min) => {
    const n = Number(text)
    if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}\n${USAGE}`)
    return n
  }
  return {
    help: values.help,
    day: values.day || null,
    catchUp: values['catch-up'] === undefined ? DEFAULT_CATCH_UP : int(values['catch-up'], 'catch-up', 1),
    explicitCatchUp: values['catch-up'] !== undefined,
    dryRun: values['dry-run'],
    writeStore: !values['dry-run'] || values.store,
    repos: values.repos ? values.repos.split(',').map((r) => r.trim()).filter(Boolean) : null,
    prs: !values['no-prs'],
    config: resolve(values.config),
    lookbackDays: int(values['lookback-days'], 'lookback-days', 0),
    concurrency: int(values.concurrency, 'concurrency', 1),
  }
}

function sumStats(repoDays) {
  const totals = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]))
  for (const rd of repoDays) for (const k of STAT_KEYS) totals[k] += rd.stats[k]
  return { ...totals, activeRepos: repoDays.filter((rd) => rd.stats.commits > 0).length }
}

/** Orchestrates one digest run: plan days, extract once per repo, store locally, post paced, receipt each 2xx. */
export class DigestRunner {
  constructor({ config, store, poster = null, prFetcher = null, now = () => new Date(), timeZone = null, lookbackDays = 60, concurrency = 4, log = () => {}, print = (t) => process.stdout.write(t) }) {
    Object.assign(this, { config, store, poster, prFetcher, now, timeZone, lookbackDays, concurrency, log, print })
    this.identities = new IdentityMatcher(config.identities)
  }

  async collect(names, firstDay, lastDay) {
    const extractor = new RepoExtractor({
      identities: this.identities, since: shiftDay(firstDay, -1), until: shiftDay(lastDay, 1),
      lookbackDays: this.lookbackDays, maxSquashRefs: 400, baseline: false,
    })
    const prSince = shiftDay(firstDay, -PR_LOOKBACK_DAYS)
    const rows = await mapLimit(names, this.concurrency, async (name) => {
      const path = repoPath(this.config.root, name)
      const overrides = this.config.repo_overrides[name] || {}
      const t0 = Date.now()
      const pr = this.prFetcher ? await this.prFetcher.fetchOne(name, path, prSince) : { records: null, note: 'PR fetch disabled' }
      const prMs = Date.now() - t0
      try {
        const classifier = new PathClassifier({ excludeGlobs: [...this.config.exclude_paths, ...(overrides.exclude_paths || [])], dirDepth: 2 })
        const result = await extractor.extract(path, { classifier, prs: pr.records, noise: overrides.noise_commits || [] })
        const ms = Date.now() - t0
        this.log(`ok    ${name}: ${result.commits.length} window commits, prs ${pr.records ? pr.records.length : 'n/a'} (${ms} ms, prs ${prMs} ms)`)
        return [name, { commits: result.commits, warnings: result.meta.warnings, pr, ms, prMs }]
      } catch (err) {
        this.log(`ERROR ${name}: ${err.message}`)
        return [name, { error: err.message, pr, ms: Date.now() - t0, prMs }]
      }
    })
    return new Map(rows)
  }

  buildDay(day, collected) {
    const repoDays = []
    const errors = {}
    for (const [name, data] of collected) {
      if (data.error) {
        errors[name] = data.error
        continue
      }
      repoDays.push(buildRepoDay(name, day, data.commits, { prs: data.pr.records, prNote: data.pr.note, timeZone: this.timeZone }))
    }
    return { repoDays, errors }
  }

  async postDay(day, repoDays, { dryRun }) {
    let posted = 0
    let skipped = 0
    let failed = 0
    for (const rd of repoDays.filter((r) => r.stats.commits > 0)) {
      const payload = buildPayload(rd)
      if (dryRun) {
        this.print(`${JSON.stringify(payload, null, 2)}\n`)
        continue
      }
      if (this.store.isPosted(day, rd.repo)) {
        skipped++
        continue
      }
      const res = await this.poster.post(payload)
      if (res.ok) {
        this.store.recordPost(day, rd.repo, { memoryId: res.memoryId, status: res.status })
        posted++
        this.log(`post  ${rd.repo} ${day}: ${res.status} ${res.memoryId ?? ''}`)
      } else {
        failed++
        this.log(`FAIL  ${rd.repo} ${day}: ${res.status} ${String(res.error).slice(0, 200)}`)
      }
    }
    return { posted, skipped, failed }
  }

  async run({ day = null, catchUp = DEFAULT_CATCH_UP, explicitCatchUp = false, dryRun = false, writeStore = !dryRun, repos = null } = {}) {
    const startedAt = Date.now()
    const today = localDayOf(this.now(), this.timeZone)
    const days = planDays({ today, receipts: this.store.readReceipts(), day, catchUp, explicitCatchUp })
    const report = { today, days, perDay: {}, failures: 0, extractMs: 0, totalMs: 0 }
    if (!days.length) {
      this.log(`nothing to digest (today ${today}; all days in window receipted)`)
      return report
    }
    if (!dryRun && !this.poster) throw new Error('a poster is required unless --dry-run')
    const names = repos || this.config.repos
    this.log(`digest ${days.join(', ')} for ${names.length} repos${dryRun ? ' (dry run)' : ''}`)
    const collected = await this.collect(names, days[0], days.at(-1))
    report.extractMs = Date.now() - startedAt
    report.repoTimings = Object.fromEntries([...collected].map(([n, d]) => [n, { ms: d.ms, prMs: d.prMs }]))
    for (const d of days) {
      const { repoDays, errors } = this.buildDay(d, collected)
      const generatedAt = new Date().toISOString()
      if (writeStore) {
        const prNotes = Object.fromEntries([...collected].filter(([, v]) => v.pr?.note).map(([n, v]) => [n, v.pr.note]))
        this.store.writeDaily(d, {
          day: d, generatedAt, timeZone: this.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          note: 'owner_human + owner_agent counted commits by author date (local day); cross-repo duplicates not removed',
          totals: sumStats(repoDays), errors, prNotes, repos: Object.fromEntries(repoDays.map((rd) => [rd.repo, rd])),
        })
        this.store.appendHistory(repoDays.map((rd) => ({ day: d, repo: rd.repo, ...rd.stats, generatedAt })))
      }
      const outcome = await this.postDay(d, repoDays, { dryRun })
      const errorCount = Object.keys(errors).length
      report.failures += outcome.failed + errorCount
      if (!dryRun && !outcome.failed && !errorCount) this.store.markComplete(d, { activeRepos: repoDays.filter((r) => r.stats.commits > 0).length })
      report.perDay[d] = { ...outcome, active: repoDays.filter((r) => r.stats.commits > 0).length, errors: errorCount }
      this.log(`day   ${d}: active ${report.perDay[d].active}, posted ${outcome.posted}, already ${outcome.skipped}, failed ${outcome.failed}, repo errors ${errorCount}`)
    }
    report.totalMs = Date.now() - startedAt
    return report
  }
}

async function main() {
  const options = parseDigestCli(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const log = (msg) => console.error(`[git-digest ${new Date().toISOString()}] ${msg}`)
  loadEnvFile(join(scriptDir, '..', '..', '.env.local'))
  const config = loadConfig(options.config)
  const store = new DigestStore()
  const poster = options.dryRun ? null : new AeonPoster({ baseUrl: process.env.AEON_BASE_URL, apiKey: process.env.AEON_API_KEY, log })
  if (!options.dryRun && !store.acquireLock()) {
    log(`another digest run holds ${store.lockPath}; exiting`)
    return 0
  }
  try {
    const prFetcher = options.prs ? new DigestPrFetcher({ log }) : null
    const runner = new DigestRunner({ config, store, poster, prFetcher, lookbackDays: options.lookbackDays, concurrency: options.concurrency, log })
    const report = await runner.run(options)
    log(`done in ${(report.totalMs / 1000).toFixed(1)} s (extraction ${(report.extractMs / 1000).toFixed(1)} s); failures ${report.failures}`)
    return report.failures ? 2 : 0
  } finally {
    if (!options.dryRun) store.releaseLock()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`[git-digest] ${err.message}`)
    process.exit(1)
  })
}
