import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { gitTokens, runGit } from './git.mjs'
import { REV_ARGS, logArgs, parseLogTokens } from './log-parse.mjs'
import {
  assignPatchDuplicates, computePatchIds, detectSquashMerges, listBranchRefs, markDefaultBranch, resolveDefaultRefs,
} from './dedupe.mjs'
import { SquashClassifier, applyDropReasons, applyNoise } from './squash.mjs'
import { attributeAi, localDay } from './summary.mjs'

const DAY_MS = 86400000
const OWNER_CLASSES = new Set(['owner_human', 'owner_agent'])

function canonicalPath(path) {
  try {
    return realpathSync.native(resolve(path)).toLowerCase()
  } catch {
    return resolve(path).toLowerCase()
  }
}

export function shiftDay(day, deltaDays) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + deltaDays * DAY_MS).toISOString().slice(0, 10)
}

class BaselineTally {
  constructor() {
    this.groups = new Map()
  }

  add(cls, c) {
    for (const key of OWNER_CLASSES.has(cls) ? [cls, 'owner'] : [cls]) {
      if (!this.groups.has(key)) {
        this.groups.set(key, { commits: 0, linesAdded: 0, linesRemoved: 0, rawLinesAdded: 0, codeAdded: 0, codeRemoved: 0, codeAddedInclGiant: 0, linesAddedExclGiant: 0, giantCommits: 0, firstCommit: null, lastCommit: null })
      }
      const g = this.groups.get(key)
      g.commits++
      g.linesAdded += c.linesAdded
      g.linesRemoved += c.linesRemoved
      g.rawLinesAdded += c.rawLinesAdded
      g.codeAddedInclGiant += c.buckets.code.added
      if (c.giant) g.giantCommits++
      else {
        g.linesAddedExclGiant += c.linesAdded
        g.codeAdded += c.buckets.code.added
        g.codeRemoved += c.buckets.code.removed
      }
      if (!g.firstCommit || c.authorDate < g.firstCommit) g.firstCommit = c.authorDate
      if (!g.lastCommit || c.authorDate > g.lastCommit) g.lastCommit = c.authorDate
    }
  }

  toJSON() {
    return Object.fromEntries([...this.groups].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  }
}

export class RepoExtractor {
  constructor({ identities, since, until = null, lookbackDays = 60, maxSquashRefs = 400, baseline = true, agentEraStart = null }) {
    this.identities = identities
    this.since = since
    this.until = until
    this.lookbackStart = shiftDay(since, -lookbackDays)
    this.maxSquashRefs = maxSquashRefs
    this.baseline = baseline
    this.agentEraStart = agentEraStart
  }

  inWindow(commit) {
    const day = localDay(commit.authorDate)
    return day >= this.since && (!this.until || day <= this.until)
  }

  async probe(repo, warnings) {
    if (!existsSync(repo)) throw new Error(`repo folder not found: ${repo}`)
    const top = await runGit(repo, ['rev-parse', '--show-toplevel', '--is-shallow-repository'], { allowFail: true })
    if (top.code !== 0) throw new Error(`not a git repository: ${top.stderr.slice(0, 200)}`)
    const [topLevel, shallow] = top.stdout.trim().split(/\r?\n/)
    if (canonicalPath(topLevel) !== canonicalPath(repo)) {
      throw new Error(`folder is not a repository root (enclosing repo: ${topLevel})`)
    }
    if (shallow === 'true') warnings.push('shallow clone: history before the graft point is missing')
    const partial = await runGit(repo, ['config', '--get', 'extensions.partialclone'], { allowFail: true })
    if (partial.stdout.trim()) warnings.push('partial clone: missing blobs are never fetched (GIT_NO_LAZY_FETCH)')
  }

  async readCommits(repo, revArgs, classifier) {
    const commits = []
    const bySha = new Map()
    const readLog = (async () => {
      for await (const commit of parseLogTokens(gitTokens(repo, logArgs(revArgs)), classifier)) {
        if (bySha.has(commit.sha)) continue
        bySha.set(commit.sha, commit)
        commits.push(commit)
      }
    })()
    const [, patchIds] = await Promise.all([readLog, computePatchIds(repo, revArgs)])
    for (const commit of commits) commit.patchId = patchIds.get(commit.sha) ?? null
    return { commits, bySha }
  }

  async computeBaseline(repo, classifier, lookbackCommits) {
    const tally = new BaselineTally()
    const seen = new Set()
    const take = (c) => {
      if (c.isMerge || seen.has(c.sha) || localDay(c.authorDate) >= this.since) return
      seen.add(c.sha)
      tally.add(this.identities.classify(c.authorName, c.authorEmail), c)
    }
    for (const c of lookbackCommits) take(c)
    const args = logArgs([...REV_ARGS, '--no-merges', `--until=${this.since}`])
    for await (const c of parseLogTokens(gitTokens(repo, args), classifier)) take(c)
    return { before: this.since, note: 'merges excluded; no patch-id or squash dedupe; linesAdded is authored (excl. generated/data and excluded paths); codeAdded excludes giant commits', byIdentity: tally.toJSON() }
  }

  async extract(repo, { classifier, prs = null, noise = [] }) {
    const startedAt = Date.now()
    const warnings = []
    await this.probe(repo, warnings)
    const refs = await listBranchRefs(repo)
    if (!refs.length) {
      return { commits: [], meta: { warnings: [...warnings, 'no branches or remote-tracking refs'], defaultRefs: [], durationMs: Date.now() - startedAt } }
    }
    const revArgs = [...REV_ARGS, `--since=${this.lookbackStart}`]
    const { commits, bySha } = await this.readCommits(repo, revArgs, classifier)

    let defaultRefs = resolveDefaultRefs(refs)
    if (!defaultRefs.length) {
      defaultRefs = ['HEAD']
      warnings.push('no origin/HEAD, main or master ref: HEAD used as default branch')
    }
    const tipShas = new Set(refs.map((r) => r.sha))
    const reachable = await markDefaultBranch(repo, defaultRefs, bySha, tipShas)
    assignPatchDuplicates(commits)
    const squash = await detectSquashMerges(repo, {
      refs, defaultRefs, reachable, commits, bySha,
      sinceUnix: Date.parse(`${this.lookbackStart}T00:00:00Z`) / 1000,
      maxRefs: this.maxSquashRefs,
    })
    if (squash.skipped) warnings.push(`patch squash detection skipped ${squash.skipped} older unmerged refs (cap ${this.maxSquashRefs})`)
    const prRule = await new SquashClassifier(repo, { refs, reachable, defaultRefs, prs }).classify(commits, (c) => this.inWindow(c))
    if (!prs) warnings.push('no PR data: squash rule used the per-repo fallback heuristic')
    applyNoise(commits, noise)
    applyDropReasons(commits)

    const windowed = commits.filter((c) => this.inWindow(c))
    for (const commit of windowed) {
      commit.identityClass = this.identities.classify(commit.authorName, commit.authorEmail)
      attributeAi(commit, this.agentEraStart)
    }
    windowed.sort((a, b) => (Date.parse(a.authorDate) || 0) - (Date.parse(b.authorDate) || 0) || (a.sha < b.sha ? -1 : 1))
    const baseline = this.baseline ? await this.computeBaseline(repo, classifier, commits) : null
    return {
      commits: windowed,
      meta: {
        defaultRefs,
        refCount: refs.length,
        scannedCommits: commits.length,
        squash: { ...squash, ...prRule },
        baseline,
        warnings,
        durationMs: Date.now() - startedAt,
      },
    }
  }
}
