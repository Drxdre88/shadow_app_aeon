import { BUCKETS } from './classify.mjs'
import { isUnique, isoWeek, localDay } from './summary.mjs'

export const OWNER_CLASSES = new Set(['owner_human', 'owner_agent'])
export const AI_REASONS = ['agent_identity', 'trailer', 'agent_era']
const DAY_MS = 86400000
const TOP_DIRS = 3

export const isOwner = (c) => OWNER_CLASSES.has(c.identityClass)
export const isCounted = (c) => isUnique(c, { crossRepo: true })
export const isFlagged = (c) => Boolean(c.giant || c.noise)
export const monthOf = (isoDate) => localDay(isoDate).slice(0, 7)

export function aiReasonOf(c, eraStart = null) {
  if ('aiAttributed' in c) return c.aiAttributed ? c.aiReason || 'trailer' : null
  if (c.identityClass === 'owner_agent') return 'agent_identity'
  if (c.aiAssisted) return 'trailer'
  if (eraStart && isOwner(c) && localDay(c.authorDate) >= eraStart) return 'agent_era'
  return null
}

export function repoKind(repo) {
  if (/_app_|_dash$/.test(repo)) return 'app'
  if (/_lab$/.test(repo)) return 'lab'
  return 'other'
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

export function monthRange(startDay, endDay) {
  const out = []
  let [y, m] = startDay.slice(0, 7).split('-').map(Number)
  const end = endDay.slice(0, 7)
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(key)
    if (key >= end) return out
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
}

export function weekRange(startDay, endDay) {
  const weeks = []
  for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
    const week = isoWeek(day)
    if (!weeks.length || weeks[weeks.length - 1].week !== week) weeks.push({ week, start: day })
  }
  return weeks
}

export function streaks(sortedDays) {
  let longestRun = 0
  let run = 0
  let longestGap = 0
  let gapFrom = null
  for (let i = 0; i < sortedDays.length; i++) {
    const gap = i ? daysBetween(sortedDays[i - 1], sortedDays[i]) : 1
    run = gap === 1 ? run + 1 : 1
    longestRun = Math.max(longestRun, run)
    if (gap - 1 > longestGap) {
      longestGap = gap - 1
      gapFrom = sortedDays[i - 1]
    }
  }
  return { longestRun, longestGap, gapFrom }
}

export class Tally {
  constructor() {
    this.commits = 0
    this.ai = 0
    this.aiReasons = Object.fromEntries(AI_REASONS.map((r) => [r, 0]))
    this.aiAdded = 0
    this.aiRemoved = 0
    this.aiCode = { added: 0, removed: 0 }
    this.added = 0
    this.removed = 0
    this.rawAdded = 0
    this.rawRemoved = 0
    this.pathAdded = 0
    this.pathRemoved = 0
    this.buckets = Object.fromEntries(BUCKETS.map((b) => [b, { added: 0, removed: 0 }]))
    this.filesAdded = 0
    this.filesModified = 0
    this.filesDeleted = 0
    this.filesRenamed = 0
    this.flaggedCommits = 0
    this.flaggedCode = 0
    this.days = new Set()
    this.dirs = new Map()
    this.first = null
    this.last = null
  }

  add(c) {
    const day = localDay(c.authorDate)
    const code = c.buckets?.code || { added: 0, removed: 0 }
    this.commits++
    this.days.add(day)
    if (!this.first || day < this.first) this.first = day
    if (!this.last || day > this.last) this.last = day
    if (c.aiReason_) {
      this.ai++
      this.aiReasons[c.aiReason_] = (this.aiReasons[c.aiReason_] || 0) + 1
      this.aiAdded += c.linesAdded
      this.aiRemoved += c.linesRemoved
      this.aiCode.added += code.added
      this.aiCode.removed += code.removed
    }
    this.added += c.linesAdded
    this.removed += c.linesRemoved
    this.rawAdded += c.rawLinesAdded ?? c.linesAdded
    this.rawRemoved += c.rawLinesRemoved ?? c.linesRemoved
    this.pathAdded += c.excludedAdded || 0
    this.pathRemoved += c.excludedRemoved || 0
    if (isFlagged(c)) {
      this.flaggedCommits++
      this.flaggedCode += code.added
    }
    for (const b of BUCKETS) {
      this.buckets[b].added += c.buckets?.[b]?.added || 0
      this.buckets[b].removed += c.buckets?.[b]?.removed || 0
    }
    this.filesAdded += c.filesAdded || 0
    this.filesModified += c.filesModified || 0
    this.filesDeleted += c.filesDeleted || 0
    this.filesRenamed += c.filesRenamed || 0
    for (const [dir, lines] of Object.entries(c.codeDirs || {})) this.dirs.set(dir, (this.dirs.get(dir) || 0) + lines)
  }

  get code() {
    return this.buckets.code
  }

  get codeAndTests() {
    return { added: this.buckets.code.added + this.buckets.tests.added, removed: this.buckets.code.removed + this.buckets.tests.removed }
  }

  get activeDays() {
    return this.days.size
  }

  topDirs(n = TOP_DIRS) {
    return [...this.dirs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map(([dir, lines]) => ({ dir, lines }))
  }
}

export function dedupeStats(ownerCommits) {
  const stats = { seen: ownerCommits.length, counted: 0, merges: 0, patchDup: 0, squashDup: 0, squashBranch: 0, crossRepo: 0, other: 0 }
  for (const c of ownerCommits) {
    if (isCounted(c)) stats.counted++
    else if (c.isMerge || c.dropReason === 'merge') stats.merges++
    else if (c.dropReason === 'patch-dup') stats.patchDup++
    else if (c.dropReason === 'squash-dup') stats.squashDup++
    else if (c.dropReason === 'squash-branch-present') stats.squashBranch++
    else if (c.crossRepoDupOf || c.crossRepoPatchDupOf) stats.crossRepo++
    else stats.other++
  }
  return stats
}

export function aggregateCommits(commits, { months, weeks, eraStart = null }) {
  const owner = commits.filter(isOwner)
  const counted = owner.filter(isCounted).map((c) => ({ ...c, aiReason_: aiReasonOf(c, eraStart) }))
  const total = new Tally()
  const byMonth = new Map(months.map((m) => [m, new Tally()]))
  const byRepo = new Map()
  const repoMonths = new Map()
  const byWeek = new Map(weeks.map((w) => [w.week, 0]))
  for (const c of counted) {
    const month = monthOf(c.authorDate)
    total.add(c)
    if (!byMonth.has(month)) byMonth.set(month, new Tally())
    byMonth.get(month).add(c)
    if (!byRepo.has(c.repo)) {
      byRepo.set(c.repo, new Tally())
      repoMonths.set(c.repo, new Map())
    }
    byRepo.get(c.repo).add(c)
    const rm = repoMonths.get(c.repo)
    rm.set(month, (rm.get(month) || 0) + 1)
    const week = isoWeek(localDay(c.authorDate))
    byWeek.set(week, (byWeek.get(week) || 0) + 1)
  }
  return { owner, counted, total, byMonth, byRepo, repoMonths, byWeek, dedupe: dedupeStats(owner), flagged: counted.filter(isFlagged) }
}

export function monthlySeries(months, byMonth, prMonths) {
  let cumAdded = 0
  let cumCode = 0
  return months.map((month) => {
    const t = byMonth.get(month) || new Tally()
    cumAdded += t.added
    cumCode += t.code.added
    const pr = prMonths.get(month) || { opened: 0, merged: 0, aiOpened: 0 }
    return {
      month,
      commits: t.commits,
      ai: t.ai,
      aiShare: t.commits ? t.ai / t.commits : null,
      aiCodeAdded: t.aiCode.added,
      added: t.added,
      removed: t.removed,
      codeAdded: t.code.added,
      codeRemoved: t.code.removed,
      activeDays: t.activeDays,
      cumAdded,
      cumCode,
      prsOpened: pr.opened,
      prsMerged: pr.merged,
      prsAi: pr.aiOpened || 0,
      tally: t,
    }
  })
}

export function baselineRows(repoSummaries, byRepo, since) {
  const rows = []
  for (const [repo, meta] of Object.entries(repoSummaries)) {
    const base = meta.baseline?.byIdentity?.owner
    if (!base || !base.commits) continue
    const year = byRepo.get(repo) || new Tally()
    rows.push({
      repo,
      before: meta.baseline.before || since,
      baseCommits: base.commits,
      baseAdded: base.linesAdded,
      baseCode: base.codeAddedInclGiant ?? base.codeAdded,
      baseGiant: base.giantCommits || 0,
      baseFirst: localDay(base.firstCommit),
      baseLast: localDay(base.lastCommit),
      yearCommits: year.commits,
      yearAdded: year.added,
      yearCode: year.code.added,
    })
  }
  return rows.sort((a, b) => (a.baseFirst < b.baseFirst ? -1 : a.baseFirst > b.baseFirst ? 1 : a.repo < b.repo ? -1 : 1))
}
