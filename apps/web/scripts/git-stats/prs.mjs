// Read-only pull-request history fetcher for the owner's repos.
//
// Usage: node prs.mjs --since 2025-10-07 --out <dir> [--root <dev_26>] [--repos a,b]
//
// Azure DevOps repos authenticate with the credential Git Credential Manager
// already holds (git credential fill); GitHub repos use `gh api` with a
// process-scoped GH_TOKEN for Drxdre88. Only GET requests are issued and no
// credential is ever printed or written.

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const TITLE_MAX = 120
export const DETAIL_CAP = 300
export const CONCURRENCY = 4
const ADO_PAGE = 100
const ADO_MAX_PAGES = 200
const GH_USER = 'Drxdre88'

export const DEFAULT_REPOS = Object.freeze([
  'arcane_configs_lab', 'arcane_dag_lab', 'arcane_data_lab', 'arcane_dev_lab', 'arcane_llm_lab',
  'arcane_ml_lab', 'evo_research_lab', 'meteo_lab', 'shadow_app_aeon', 'shadow_app_antares',
  'shadow_app_arq', 'shadow_app_chimaera', 'shadow_app_hydra', 'shadow_app_rift',
  'shadow_app_shadowlab', 'shadow_app_swarm', 'shadow_app_triad', 'shadow_app_visor',
  'shadow_app_vulcan', 'shadow_app_wraith', 'shadow_dag_lab', 'shadow_data_lab', 'shadow_dev_lab',
  'shadow_lab', 'shadow_ml_lab', 'shadow_research_lab', 'stp_app_dmc', 'stp_app_ermac',
  'stp_app_poseidon', 'stp_app_relic', 'kal_el_dash',
])

// ─── pure helpers ───────────────────────────────────────────────────────

const ADO_REMOTE = /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)\/?$/
const GH_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/

/** Classify an origin URL as Azure DevOps, GitHub, unknown or missing. */
export function parseRemote(url) {
  const value = typeof url === 'string' ? url.trim() : ''
  if (!value) return { kind: 'none' }
  const ado = ADO_REMOTE.exec(value)
  if (ado) return { kind: 'ado', org: ado[1], project: ado[2], repo: ado[3] }
  const gh = GH_REMOTE.exec(value)
  if (gh) return { kind: 'github', owner: gh[1], repo: gh[2] }
  return { kind: 'unknown', url: value.replace(/\/\/[^@/]+@/, '//') }
}

export function clip(text, max = TITLE_MAX) {
  if (typeof text !== 'string') return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

const orNull = (value) => (value === undefined || value === '' ? null : value)
const stripRef = (ref) => (typeof ref === 'string' ? ref.replace(/^refs\/heads\//, '') : null)

/** True when the ISO timestamp falls on or after the YYYY-MM-DD `since` day (UTC). */
export function isSince(createdAt, since) {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  const s = Date.parse(`${since}T00:00:00Z`)
  return Number.isFinite(t) && Number.isFinite(s) && t >= s
}

/** Map one ADO pullrequests item to the shared record shape. */
export function normaliseAdoPr(raw, repoName) {
  const by = raw?.createdBy ?? {}
  return {
    repo: repoName,
    source: 'ado',
    id: raw?.pullRequestId ?? null,
    title: clip(raw?.title),
    status: orNull(raw?.status),
    rawStatus: orNull(raw?.status),
    author: { displayName: orNull(by.displayName), login: orNull(by.uniqueName) },
    createdAt: orNull(raw?.creationDate),
    closedAt: orNull(raw?.closedDate),
    sourceRef: stripRef(raw?.sourceRefName),
    targetRef: stripRef(raw?.targetRefName),
    mergeStatus: orNull(raw?.mergeStatus),
    isDraft: Boolean(raw?.isDraft),
    mergeStrategy: orNull(raw?.completionOptions?.mergeStrategy),
    mergeCommit: orNull(raw?.lastMergeCommit?.commitId),
    commitCount: null,
    additions: null,
    deletions: null,
    changedFiles: null,
  }
}

/** Map one GitHub pulls item (optionally enriched by the per-PR GET) to the shared shape. */
export function normaliseGhPr(raw, repoName, detail = null) {
  const merged = Boolean(raw?.merged_at)
  const status = raw?.state === 'open' ? 'active' : merged ? 'completed' : 'abandoned'
  const num = (key) => (Number.isFinite(detail?.[key]) ? detail[key] : null)
  return {
    repo: repoName,
    source: 'github',
    id: raw?.number ?? null,
    title: clip(raw?.title),
    status,
    rawStatus: orNull(raw?.state),
    author: { displayName: orNull(raw?.user?.login), login: orNull(raw?.user?.login) },
    createdAt: orNull(raw?.created_at),
    closedAt: orNull(raw?.closed_at),
    mergedAt: orNull(raw?.merged_at),
    sourceRef: orNull(raw?.head?.ref),
    targetRef: orNull(raw?.base?.ref),
    mergeStatus: detail ? orNull(detail.mergeable_state) : null,
    isDraft: Boolean(raw?.draft),
    mergeStrategy: null,
    mergeCommit: orNull(raw?.merge_commit_sha),
    commitCount: num('commits'),
    additions: num('additions'),
    deletions: num('deletions'),
    changedFiles: num('changed_files'),
  }
}

/** Parse `gh api --jq '.[]'` output: one compact JSON object per line. */
export function parseJsonLines(text) {
  if (typeof text !== 'string') return []
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
}

export function adoPullsUrl({ org, project, repo }, skip, since) {
  const q = new URLSearchParams({
    'searchCriteria.status': 'all',
    'searchCriteria.queryTimeRangeType': 'created',
    'searchCriteria.minTime': `${since}T00:00:00Z`,
    $top: String(ADO_PAGE),
    $skip: String(skip),
    'api-version': '7.1',
  })
  return `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests?${q}`
}

const STATUSES = new Set(['completed', 'abandoned', 'active'])
const bump = (map, key) => { map[key] = (map[key] ?? 0) + 1 }

/** Per-repo counts: total, by status, by author and by creation month. */
export function summariseRepo(records) {
  const out = { created: records.length, completed: 0, abandoned: 0, active: 0, byAuthor: {}, byMonth: {} }
  for (const pr of records) {
    if (STATUSES.has(pr.status)) out[pr.status] += 1
    bump(out.byAuthor, pr.author?.login ?? pr.author?.displayName ?? 'unknown')
    if (pr.createdAt) bump(out.byMonth, pr.createdAt.slice(0, 7))
  }
  return out
}

/** Markdown table of the per-repo results (counts or failure reason). */
export function summaryMarkdown(results, since) {
  const lines = [
    `# Pull requests since ${since}`, '',
    '| repo | host | created | completed | abandoned | active | note |',
    '|---|---|---:|---:|---:|---:|---|',
  ]
  for (const r of results) {
    const s = r.summary
    const cells = s ? [s.created, s.completed, s.abandoned, s.active] : ['', '', '', '']
    lines.push(`| ${r.repo} | ${r.host} | ${cells.join(' | ')} | ${r.error ?? r.note ?? ''} |`)
  }
  return `${lines.join('\n')}\n`
}

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ─── Azure DevOps (GET only) ────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`)
    this.status = status
    this.url = url
  }
}

export class AdoClient {
  #auth = new Map()

  #authHeader(remote) {
    if (this.#auth.has(remote.org)) return this.#auth.get(remote.org)
    const query = `protocol=https\nhost=dev.azure.com\npath=${remote.org}/${remote.project}/_git/${remote.repo}\nusername=${remote.org}\n\n`
    let header = null
    try {
      const text = execFileSync('git', ['credential', 'fill'], {
        input: query, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      })
      const secret = text.split(/\r?\n/).find((l) => l.startsWith('password='))?.slice('password='.length)
      if (secret) header = `Basic ${Buffer.from(`:${secret}`).toString('base64')}`
    } catch {
      header = null
    }
    this.#auth.set(remote.org, header)
    return header
  }

  async get(remote, url) {
    const header = this.#authHeader(remote)
    if (!header) throw new Error('no git credential for dev.azure.com')
    const res = await fetch(url, { method: 'GET', headers: { Authorization: header, Accept: 'application/json' }, redirect: 'manual' })
    if (!res.ok) throw new HttpError(res.status, url)
    if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`auth rejected (HTTP ${res.status}, non-JSON)`)
    return res.json()
  }

  async fetchRepo(remote, name, since) {
    const raw = []
    for (let page = 0; page < ADO_MAX_PAGES; page++) {
      const body = await this.get(remote, adoPullsUrl(remote, page * ADO_PAGE, since))
      const items = body?.value ?? []
      raw.push(...items)
      if (items.length < ADO_PAGE) break
    }
    const records = raw.filter((pr) => isSince(pr.creationDate, since)).map((pr) => normaliseAdoPr(pr, name))
    let note = null
    if (records.length > DETAIL_CAP) {
      note = `commit counts skipped (${records.length} > ${DETAIL_CAP})`
    } else {
      const base = `https://dev.azure.com/${remote.org}/${remote.project}/_apis/git/repositories/${remote.repo}`
      let failed = 0
      await mapLimit(records, CONCURRENCY, async (pr) => {
        try {
          const body = await this.get(remote, `${base}/pullRequests/${pr.id}/commits?$top=1000&api-version=7.1`)
          pr.commitCount = Array.isArray(body?.value) ? body.value.length : null
        } catch {
          failed += 1
        }
      })
      if (failed) note = `commit count failed for ${failed} PRs`
    }
    return { records, note }
  }
}

// ─── GitHub via gh (GET only) ───────────────────────────────────────────

export class GhClient {
  #env = null

  #token() {
    if (this.#env) return this.#env
    const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com', '--user', GH_USER], {
      encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!token) throw new Error(`no gh token for ${GH_USER}`)
    this.#env = { ...process.env, GH_TOKEN: token }
    return this.#env
  }

  async api(path, extra = []) {
    const { stdout } = await execFileAsync('gh', ['api', '--method', 'GET', path, ...extra], {
      env: this.#token(), maxBuffer: 256 * 1024 * 1024, timeout: 300_000,
    })
    return stdout
  }

  async fetchRepo(remote, name, since) {
    const text = await this.api(`repos/${remote.owner}/${remote.repo}/pulls?state=all&per_page=100`, ['--paginate', '--jq', '.[]'])
    const raws = parseJsonLines(text).filter((pr) => isSince(pr.created_at, since))
    if (raws.length > DETAIL_CAP) {
      return { records: raws.map((pr) => normaliseGhPr(pr, name)), note: `per-PR stats skipped (${raws.length} > ${DETAIL_CAP})` }
    }
    let failed = 0
    const records = await mapLimit(raws, CONCURRENCY, async (pr) => {
      try {
        const detail = JSON.parse(await this.api(`repos/${remote.owner}/${remote.repo}/pulls/${pr.number}`))
        return normaliseGhPr(pr, name, detail)
      } catch {
        failed += 1
        return normaliseGhPr(pr, name)
      }
    })
    return { records, note: failed ? `per-PR stats failed for ${failed} PRs` : null }
  }
}

// ─── orchestration ──────────────────────────────────────────────────────

function readOrigin(path) {
  try {
    return execFileSync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

export function errorText(err) {
  if (err instanceof HttpError) return err.status >= 300 && err.status < 400 ? `auth redirect (HTTP ${err.status})` : err.message
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : ''
  return (stderr || String(err?.message ?? err)).split('\n')[0].slice(0, 200)
}

export class PrHistory {
  constructor({ root, since, ado = new AdoClient(), gh = new GhClient(), log = (m) => console.error(m) }) {
    Object.assign(this, { root, since, ado, gh, log })
  }

  async fetchOne(name) {
    const remote = parseRemote(readOrigin(join(this.root, name)))
    const base = { repo: name, host: remote.kind, remote: remote.kind === 'unknown' ? remote.url : undefined }
    if (remote.kind === 'none') return { ...base, records: [], error: 'no origin remote' }
    if (remote.kind === 'unknown') return { ...base, records: [], error: 'unsupported remote host' }
    const client = remote.kind === 'ado' ? this.ado : this.gh
    try {
      const { records, note } = await client.fetchRepo(remote, name, this.since)
      return { ...base, records, note }
    } catch (err) {
      return { ...base, records: [], error: errorText(err) }
    }
  }

  async run(repos) {
    const results = []
    for (const name of repos) {
      const started = Date.now()
      const result = await this.fetchOne(name)
      result.summary = result.error ? null : summariseRepo(result.records)
      this.log(`${name}: ${result.error ?? `${result.records.length} PRs`} (${Date.now() - started} ms)`)
      results.push(result)
    }
    return results
  }
}

export function writeOutputs(outDir, results, since) {
  mkdirSync(outDir, { recursive: true })
  const all = []
  for (const r of results) {
    writeFileSync(join(outDir, `${r.repo}.json`), `${JSON.stringify({ since, ...r }, null, 2)}\n`)
    all.push(...r.records)
  }
  writeFileSync(join(outDir, 'prs.jsonl'), all.map((pr) => JSON.stringify(pr)).join('\n') + (all.length ? '\n' : ''))
  const summary = {
    since,
    generatedAt: new Date().toISOString(),
    totals: summariseRepo(all),
    repos: results.map(({ repo, host, remote, error, note, summary: s }) => ({ repo, host, remote, error: error ?? null, note: note ?? null, ...(s ?? {}) })),
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(results, since))
  return summary
}

export function parseArgs(argv) {
  const args = { since: '2025-10-07', out: null, root: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'), repos: null }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '')
    if (key in args) args[key] = argv[++i]
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.since ?? '')) throw new Error('--since must be YYYY-MM-DD')
  if (!args.out) throw new Error('--out <dir> is required')
  args.repos = args.repos ? args.repos.split(',').map((s) => s.trim()).filter(Boolean) : [...DEFAULT_REPOS]
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const results = await new PrHistory({ root: args.root, since: args.since }).run(args.repos)
  const summary = writeOutputs(resolve(args.out), results, args.since)
  console.error(`done: ${summary.totals.created} PRs across ${results.length} repos -> ${resolve(args.out)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`prs: ${errorText(err)}`)
    process.exit(1)
  })
}
