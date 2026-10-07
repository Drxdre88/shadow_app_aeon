import { AdoClient, GhClient, adoPullsUrl, errorText, mapLimit, normaliseAdoPr, normaliseGhPr, parseRemote } from './prs.mjs'
import { runGit } from './git.mjs'

export const PR_LOOKBACK_DAYS = 30
const PAGE = 100
const MAX_PAGES = 10
const REPO_TIMEOUT_MS = 90_000

function withTimeout(promise, ms, label) {
  let timer
  const guard = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

const touched = (pr, sinceMs) => [pr.createdAt, pr.closedAt, pr.mergedAt].some((t) => t && Date.parse(t) >= sinceMs)

/**
 * Cheap, read-only PR window fetch for the digest: one listing per repo, no per-PR detail calls.
 * ADO lists PRs created since `since` (PRs open longer than the lookback are missed);
 * GitHub pages PRs by most recent update until they predate `since`.
 */
export class DigestPrFetcher {
  constructor({ ado = new AdoClient(), gh = new GhClient(), origin = null, concurrency = 4, log = () => {} } = {}) {
    Object.assign(this, { ado, gh, concurrency, log })
    this.origin = origin || (async (path) => (await runGit(path, ['remote', 'get-url', 'origin'], { allowFail: true })).stdout.trim())
  }

  async adoList(remote, name, since) {
    const raw = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.ado.get(remote, adoPullsUrl(remote, page * PAGE, since))
      const items = body?.value ?? []
      raw.push(...items)
      if (items.length < PAGE) break
    }
    return raw.map((pr) => normaliseAdoPr(pr, name))
  }

  async github(remote, name, sinceMs) {
    const out = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const text = await this.gh.api(`repos/${remote.owner}/${remote.repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`)
      const items = JSON.parse(text || '[]')
      out.push(...items.map((pr) => normaliseGhPr(pr, name)))
      const oldest = items.at(-1)?.updated_at
      if (items.length < PAGE || !oldest || Date.parse(oldest) < sinceMs) break
    }
    return out
  }

  async fetchOne(name, path, since) {
    const remote = parseRemote(await this.origin(path))
    if (remote.kind === 'none') return { records: null, note: 'no origin remote' }
    if (remote.kind === 'unknown') return { records: null, note: 'unsupported remote host' }
    const sinceMs = Date.parse(`${since}T00:00:00Z`)
    try {
      const work = remote.kind === 'ado' ? this.adoList(remote, name, since) : this.github(remote, name, sinceMs)
      const records = (await withTimeout(work, REPO_TIMEOUT_MS, `${remote.kind} PR listing`)).filter((pr) => touched(pr, sinceMs))
      return { records, note: null, host: remote.kind }
    } catch (err) {
      return { records: null, note: `PR fetch failed: ${errorText(err)}`, host: remote.kind }
    }
  }

  /** Map of repo name -> { records|null, note, ms }. */
  async fetchAll(repos, since) {
    const results = await mapLimit(repos, this.concurrency, async ({ name, path }) => {
      const t0 = Date.now()
      const result = await this.fetchOne(name, path, since)
      this.log(`prs   ${name}: ${result.records ? `${result.records.length} PRs` : result.note} (${Date.now() - t0} ms)`)
      return [name, { ...result, ms: Date.now() - t0 }]
    })
    return new Map(results)
  }
}
