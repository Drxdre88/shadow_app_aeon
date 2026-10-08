import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitLines } from './git.mjs'

const ADO_SQUASH = /^Merged PR (\d+):/
const GITHUB_SQUASH = /\(#(\d+)\)\s*$/
const CLOSE_SLACK_MS = 5 * 60 * 1000

export function loadPrRecords(dir, repo) {
  if (!dir) return null
  const path = join(dir, `${repo}.json`)
  if (!existsSync(path)) return null
  const data = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data.records) || data.host === 'none') return null
  return data.records
}

export function branchName(ref) {
  return String(ref || '').replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '')
}

export function subjectPrNumber(subject) {
  const m = ADO_SQUASH.exec(subject) || GITHUB_SQUASH.exec(subject)
  return m ? Number(m[1]) : null
}

export class SquashClassifier {
  constructor(repo, { refs, reachable, defaultRefs, prs }) {
    this.repo = repo
    this.refs = refs.filter((r) => !r.symref)
    this.reachable = reachable
    this.defaultRefs = defaultRefs
    this.prs = prs
    this.prByCommit = new Map()
    this.prById = new Map()
    for (const pr of prs || []) {
      if (pr.status && pr.status !== 'completed') continue
      if (pr.mergeCommit) this.prByCommit.set(pr.mergeCommit, pr)
      this.prById.set(Number(pr.id), pr)
    }
    this.refDates = new Map()
  }

  findPr(commit) {
    const direct = this.prByCommit.get(commit.sha)
    if (direct) return { pr: direct, number: Number(direct.id) }
    const number = subjectPrNumber(commit.subject)
    if (number === null) return null
    if (!this.prs) return { pr: null, number }
    const pr = this.prById.get(number)
    return pr ? { pr, number } : null
  }

  async offMainDates(ref) {
    if (!this.refDates.has(ref.sha)) {
      const dates = []
      const args = ['log', '--no-merges', '--format=%ct', ref.sha, '--not', ...this.defaultRefs, '--']
      for await (const line of gitLines(this.repo, args)) if (line) dates.push(Number(line) * 1000)
      this.refDates.set(ref.sha, dates)
    }
    return this.refDates.get(ref.sha)
  }

  async branchPresent(pr) {
    const name = branchName(pr.sourceRef)
    const closedAt = Date.parse(pr.closedAt || pr.mergedAt || '') || Infinity
    for (const ref of this.refs) {
      if (branchName(ref.name) !== name || this.reachable.has(ref.sha)) continue
      const dates = await this.offMainDates(ref)
      if (dates.some((d) => d <= closedAt + CLOSE_SLACK_MS)) return true
    }
    return false
  }

  async classify(commits, inWindow) {
    const pending = []
    for (const c of commits) {
      if (c.isMerge || c.parents !== 1 || !c.onDefaultBranch) continue
      const found = c.dupKind === 'squash' ? { pr: this.findPr(c)?.pr ?? null, number: subjectPrNumber(c.subject) } : this.findPr(c)
      if (!found) continue
      if (found.pr?.mergeStrategy && found.pr.mergeStrategy !== 'squash') continue
      c.squashOf = found.number ?? (found.pr ? Number(found.pr.id) : null)
      if (c.dupKind === 'squash') {
        c.squashBranchPresent = true
        c.squashBasis = 'patch-match'
      } else if (c.dupOf) {
        c.squashBranchPresent = true
        c.squashBasis = 'patch-dup'
      } else if (found.pr?.sourceRef) {
        c.squashBranchPresent = await this.branchPresent(found.pr)
        c.squashBasis = 'pr-ref'
      } else pending.push(c)
    }
    const windowPending = pending.filter(inWindow)
    const offMain = commits.filter((c) => inWindow(c) && !c.isMerge && !c.onDefaultBranch).length
    const countSquashes = windowPending.length >= offMain
    for (const c of pending) {
      c.squashBranchPresent = !countSquashes
      c.squashBasis = 'fallback'
    }
    return { prRecords: this.prs ? this.prs.length : null, fallbackSquashes: windowPending.length, offMainCommits: offMain }
  }
}

export function applyNoise(commits, rules = []) {
  const compiled = rules.map((r) => ({ sha: r.sha?.toLowerCase(), subject: r.subject ? new RegExp(r.subject, 'i') : null, reason: r.reason || 'noise' }))
  for (const c of commits) {
    const hit = compiled.find((r) => (r.sha && c.sha.startsWith(r.sha)) || (r.subject && r.subject.test(c.subject)))
    if (hit) {
      c.noise = hit.reason
      c.noiseReason = hit.reason
    }
  }
}

export function applyDropReasons(commits) {
  for (const c of commits) {
    if (c.isMerge) c.dropReason = 'merge'
    else if (c.dupKind === 'squash') c.dropReason = 'squash-dup'
    else if (c.dupOf) c.dropReason = 'patch-dup'
    else if (c.squashOf !== null && c.squashBranchPresent) c.dropReason = 'squash-branch-present'
    else c.dropReason = null
    c.counted = c.dropReason === null
  }
}
