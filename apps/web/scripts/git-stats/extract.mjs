#!/usr/bin/env node
import { once } from 'node:events'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { PathClassifier } from './classify.mjs'
import { RepoExtractor } from './repo.mjs'
import { loadPrRecords } from './squash.mjs'
import { IdentityMatcher, buildSummary, isUnique } from './summary.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const DATE = /^\d{4}-\d{2}-\d{2}$/
const CROSS_REPO_PATCH_MIN_LINES = 20

export const USAGE = `Usage: node extract.mjs --since YYYY-MM-DD [--until YYYY-MM-DD] [--repos a,b] --out <dir>
  [--config repos.json] [--prs-dir <dir>] [--lookback-days 60] [--dir-depth 2] [--max-squash-refs 400] [--no-baseline]`

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      repos: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string', default: join(scriptDir, 'repos.json') },
      'lookback-days': { type: 'string', default: '60' },
      'dir-depth': { type: 'string', default: '2' },
      'max-squash-refs': { type: 'string', default: '400' },
      'prs-dir': { type: 'string' },
      'no-baseline': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) return { help: true }
  if (!values.since || !DATE.test(values.since)) throw new Error(`--since YYYY-MM-DD is required\n${USAGE}`)
  if (values.until && !DATE.test(values.until)) throw new Error(`--until must be YYYY-MM-DD\n${USAGE}`)
  if (!values.out) throw new Error(`--out <dir> is required\n${USAGE}`)
  return {
    since: values.since,
    until: values.until || null,
    repos: values.repos ? values.repos.split(',').map((r) => r.trim()).filter(Boolean) : null,
    out: resolve(values.out),
    config: resolve(values.config),
    lookbackDays: positiveInt(values['lookback-days'], 'lookback-days'),
    dirDepth: positiveInt(values['dir-depth'], 'dir-depth'),
    maxSquashRefs: positiveInt(values['max-squash-refs'], 'max-squash-refs'),
    prsDir: values['prs-dir'] ? resolve(values['prs-dir']) : null,
    baseline: !values['no-baseline'],
  }
}

function positiveInt(text, name) {
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`)
  return n
}

export function loadConfig(path) {
  const config = JSON.parse(readFileSync(path, 'utf8'))
  if (!config.root || !Array.isArray(config.repos)) throw new Error(`${path}: expected { root, repos[] }`)
  return { identities: {}, exclude_paths: [], repo_overrides: {}, ...config }
}

export function repoPath(root, name) {
  return isAbsolute(name) ? name : join(root, name)
}

const chronological = (a, b) =>
  (Date.parse(a.commitDate) || 0) - (Date.parse(b.commitDate) || 0) ||
  (Date.parse(a.authorDate) || 0) - (Date.parse(b.authorDate) || 0) ||
  (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0)

export function markCrossRepo(commits) {
  const seenSha = new Map()
  const seenPatch = new Map()
  for (const c of [...commits].sort(chronological)) {
    const shaOwner = seenSha.get(c.sha)
    if (shaOwner && shaOwner !== c.repo) {
      c.crossRepoDupOf = `${shaOwner}:${c.sha}`
      continue
    }
    seenSha.set(c.sha, c.repo)
    if (!isUnique(c) || !c.patchId || (c.rawLinesAdded ?? c.linesAdded) + (c.rawLinesRemoved ?? c.linesRemoved) < CROSS_REPO_PATCH_MIN_LINES) continue
    const first = seenPatch.get(c.patchId)
    if (first && first.repo !== c.repo) c.crossRepoPatchDupOf = `${first.repo}:${first.sha}`
    else if (!first) seenPatch.set(c.patchId, c)
  }
}

async function writeJsonl(path, rows) {
  const stream = createWriteStream(path, { encoding: 'utf8' })
  for (const row of rows) {
    if (!stream.write(`${JSON.stringify(row)}\n`)) await once(stream, 'drain')
  }
  stream.end()
  await once(stream, 'finish')
}

const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0)

function repoStatus(name, path, result) {
  const commits = result.commits
  return {
    repo: name,
    path,
    status: 'ok',
    commits: commits.length,
    uniqueCommits: commits.filter((c) => isUnique(c)).length,
    merges: commits.filter((c) => c.isMerge).length,
    duplicates: commits.filter((c) => c.dropReason === 'patch-dup').length,
    droppedSquashes: commits.filter((c) => c.dropReason === 'squash-dup' || c.dropReason === 'squash-branch-present').length,
    countedSquashes: commits.filter((c) => c.counted && c.squashOf != null).length,
    linesCountedAdded: sum(commits.filter((c) => c.counted), 'rawLinesAdded'),
    linesRawAdded: sum(commits, 'rawLinesAdded'),
    authoredAdded: sum(commits.filter((c) => c.counted), 'authoredAdded'),
    linesCountedExclGiantNoiseAdded: sum(commits.filter((c) => c.counted && !c.giant && !c.noise), 'linesAdded'),
    linesCountedExclGiantNoiseRemoved: sum(commits.filter((c) => c.counted && !c.giant && !c.noise), 'linesRemoved'),
    giantCommits: commits.filter((c) => c.giant).length,
    ...result.meta,
  }
}

export async function runExtraction(options, log = (msg) => console.error(msg)) {
  const config = loadConfig(options.config)
  const names = options.repos || config.repos
  const identities = new IdentityMatcher(config.identities)
  const extractor = new RepoExtractor({
    identities, since: options.since, until: options.until,
    lookbackDays: options.lookbackDays, maxSquashRefs: options.maxSquashRefs, baseline: options.baseline !== false,
  })
  mkdirSync(options.out, { recursive: true })
  const startedAt = new Date()
  const statuses = []
  const results = []
  for (const name of names) {
    const path = repoPath(config.root, name)
    const t0 = Date.now()
    try {
      const overrides = config.repo_overrides[name] || {}
      const classifier = new PathClassifier({ excludeGlobs: [...config.exclude_paths, ...(overrides.exclude_paths || [])], dirDepth: options.dirDepth })
      const prs = loadPrRecords(options.prsDir, name)
      const result = await extractor.extract(path, { classifier, prs, noise: overrides.noise_commits || [] })
      for (const c of result.commits) c.repo = name
      results.push({ name, path, result })
      statuses.push(repoStatus(name, path, result))
      log(`ok    ${name}: ${result.commits.length} commits (${Date.now() - t0} ms)`)
    } catch (err) {
      statuses.push({ repo: name, path, status: 'error', error: err.message, durationMs: Date.now() - t0 })
      log(`ERROR ${name}: ${err.message}`)
    }
  }
  const all = results.flatMap((r) => r.result.commits)
  markCrossRepo(all)
  const window = { since: options.since, until: options.until, lookbackDays: options.lookbackDays, prsDir: options.prsDir || null }
  for (const { name, path, result } of results) {
    const rows = result.commits.map(({ repo, ...rest }) => ({ repo, ...rest }))
    await writeJsonl(join(options.out, `${name}.commits.jsonl`), rows)
    const summary = buildSummary(result.commits, { meta: { repo: name, path, ...window, ...result.meta } })
    writeFileSync(join(options.out, `${name}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`)
  }
  await writeJsonl(join(options.out, 'commits.jsonl'), all.map(({ repo, ...rest }) => ({ repo, ...rest })))
  const durationMs = Date.now() - startedAt.getTime()
  const allSummary = buildSummary(all, { crossRepo: true, meta: { scope: 'all-repos', ...window, repos: names } })
  allSummary.ownerBaselineByRepo = Object.fromEntries(results.map((r) => [r.name, r.result.meta.baseline?.byIdentity?.owner ?? null]))
  writeFileSync(join(options.out, 'summary.all.json'), `${JSON.stringify(allSummary, null, 2)}\n`)
  const run = { startedAt: startedAt.toISOString(), durationMs, ...window, config: options.config, repos: statuses }
  writeFileSync(join(options.out, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  return run
}

async function main() {
  const options = parseCli(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const run = await runExtraction(options)
  const failed = run.repos.filter((r) => r.status === 'error')
  console.error(`done in ${(run.durationMs / 1000).toFixed(1)} s; ${run.repos.length - failed.length} ok, ${failed.length} failed`)
  return failed.length ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }, (err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
