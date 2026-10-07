import { dayLabel, fmt, hours, listJoin, monthLabel, pct, share, signed } from './report-format.mjs'
import { isAiAssisted, isExcluded, monthOf, repoKind } from './report-aggregate.mjs'

export const THRESHOLDS = {
  driverShare: 0.25,
  shiftPoints: 0.2,
  aiTrendPoints: 0.15,
  trendMonths: 3,
  mergedFastShare: 0.5,
  setAsideShare: 0.25,
  concentration: 0.3,
  gapDays: 14,
  trailerGapCommits: 50,
  maxFindings: 10,
}

export function busiestMonth(series) {
  return series.reduce((best, m) => (m.commits > (best?.commits ?? -1) ? m : best), null)
}

function aiCaveat(model) {
  const gap = trailerGap(model.counted)
  return gap ? `, a lower bound: no AI trailer was recorded after ${dayLabel(gap.last)}` : ''
}

export function headlines(model) {
  const t = model.total
  const p = model.prs.totals
  const busy = busiestMonth(model.series)
  const lines = [
    `${fmt(t.commits)} commits on ${fmt(t.activeDays)} active days across ${fmt(model.repos.filter((r) => r.tally.commits).length)} repositories, ${dayLabel(model.since)} to ${dayLabel(model.end)}.`,
    `${fmt(p.opened)} pull requests opened and ${fmt(p.merged)} merged.`,
    `${signed(t.added, t.removed)} lines you wrote, of which code ${signed(t.code.added, t.code.removed)}.`,
    `${fmt(t.filesAdded)} files added, ${fmt(t.filesModified)} changed and ${fmt(t.filesDeleted)} deleted (${fmt(t.filesRenamed)} renamed).`,
    `${pct(t.ai, t.commits)} of commits were AI-assisted (${fmt(t.ai)} of ${fmt(t.commits)})${aiCaveat(model)}.`,
  ]
  if (busy?.commits) lines.push(`Busiest month: ${monthLabel(busy.month)}, with ${fmt(busy.commits)} commits and +${fmt(busy.added)} lines written.`)
  const counting = `Only your own commits count, each change once: merge commits, rebased or cherry-picked copies, squash-merge duplicates and copies across repositories are dropped. Line figures are authored lines, so lockfiles, generated files, data and named research or vendor folders are left out, and ${fmt(t.excludedCommits)} imports and dumps (${signed(t.excludedAdded, t.excludedRemoved)} authored lines) are listed separately under "What was set aside".`
  return { lines, counting }
}

function peakMonthFinding(model) {
  const busy = busiestMonth(model.series)
  if (!busy?.commits) return null
  const active = model.series.filter((m) => m.commits).map((m) => m.commits).sort((a, b) => a - b)
  const median = active[Math.floor((active.length - 1) / 2)]
  const drivers = model.repos
    .map((r) => ({ repo: r.repo, n: r.months.get(busy.month) || 0 }))
    .filter((d) => d.n / busy.commits >= THRESHOLDS.driverShare)
    .sort((a, b) => b.n - a.n)
  const driverText = drivers.length
    ? ` Driven by ${listJoin(drivers.map((d) => `${d.repo} (${fmt(d.n)}, ${pct(d.n, busy.commits)})`))}.`
    : ' No single repository made up a quarter of it.'
  return `Commits peaked in ${monthLabel(busy.month)}${model.partialMonths.includes(busy.month) ? ' (only partly inside the window)' : ''} at ${fmt(busy.commits)}, ${(busy.commits / median).toFixed(1)}× the median active month (${fmt(median)}).${driverText}`
}

function linesPeakFinding(model) {
  const top = model.series.reduce((b, m) => (m.codeAdded > (b?.codeAdded ?? -1) ? m : b), null)
  if (!top?.codeAdded) return null
  const totalCode = model.total.code.added
  const repo = model.counted
    .filter((c) => monthOf(c.authorDate) === top.month && !isExcluded(c))
    .reduce((acc, c) => acc.set(c.repo, (acc.get(c.repo) || 0) + (c.buckets?.code?.added || 0)), new Map())
  const [leader, leaderLines] = [...repo.entries()].sort((a, b) => b[1] - a[1])[0] || ['–', 0]
  return `The most code was written in ${monthLabel(top.month)}${model.partialMonths.includes(top.month) ? ' (only partly inside the window)' : ''}: +${fmt(top.codeAdded)} code lines, ${pct(top.codeAdded, totalCode)} of the year's code, led by ${leader} (+${fmt(leaderLines)}).`
}

export function kindShift(counted, months) {
  const half = Math.floor(months.length / 2)
  const first = new Set(months.slice(0, half))
  const halves = [{ app: 0, n: 0 }, { app: 0, n: 0 }]
  for (const c of counted) {
    const h = halves[first.has(monthOf(c.authorDate)) ? 0 : 1]
    h.n++
    if (repoKind(c.repo) === 'app') h.app++
  }
  return { firstShare: share(halves[0].app, halves[0].n), secondShare: share(halves[1].app, halves[1].n), firstMonths: months.slice(0, half), secondMonths: months.slice(half), halves }
}

function shiftFinding(model) {
  const s = kindShift(model.counted, model.months)
  if (!s.halves[0].n || !s.halves[1].n) return null
  const delta = s.secondShare - s.firstShare
  if (Math.abs(delta) < THRESHOLDS.shiftPoints) return null
  const span = (ms) => `${monthLabel(ms[0])}–${monthLabel(ms[ms.length - 1])}`
  const dir = delta > 0 ? 'from labs towards apps' : 'from apps back towards labs'
  return `Work moved ${dir}: app repositories took ${pct(s.halves[0].app, s.halves[0].n)} of commits in ${span(s.firstMonths)} and ${pct(s.halves[1].app, s.halves[1].n)} in ${span(s.secondMonths)}.`
}

export function aiTrend(series, n = THRESHOLDS.trendMonths) {
  const pool = (ms) => ms.reduce((acc, m) => ({ ai: acc.ai + m.ai, commits: acc.commits + m.commits }), { ai: 0, commits: 0 })
  const early = pool(series.slice(0, n))
  const late = pool(series.slice(-n))
  return { early, late, delta: share(late.ai, late.commits) - share(early.ai, early.commits) }
}

export function trailerGap(counted, minCommits = THRESHOLDS.trailerGapCommits) {
  const aiDays = counted.filter(isAiAssisted).map((c) => c.authorDate.slice(0, 10)).sort()
  if (!aiDays.length) return null
  const last = aiDays[aiDays.length - 1]
  const after = counted.filter((c) => c.authorDate.slice(0, 10) > last).length
  return after >= minCommits ? { last, after } : null
}

function aiFinding(model) {
  const t = model.total
  if (!t.commits) return null
  const { early, late, delta } = aiTrend(model.series)
  const gap = trailerGap(model.counted)
  const gapText = gap ? ` No AI co-author trailer appears after ${dayLabel(gap.last)}, yet ${fmt(gap.after)} commits followed, so the share after that date is unmeasured rather than zero.` : ''
  const base = `${pct(t.ai, t.commits)} of commits (${fmt(t.ai)}) carry an AI co-author or agent identity.`
  if (Math.abs(delta) < THRESHOLDS.aiTrendPoints || !early.commits || !late.commits) return `${base} The share stayed within ${Math.round(THRESHOLDS.aiTrendPoints * 100)} points between the first and last ${THRESHOLDS.trendMonths} months.${gapText}`
  const peak = model.series.reduce((b, m) => (m.commits && (m.aiShare ?? 0) > (b?.aiShare ?? -1) ? m : b), null)
  const word = delta > 0 ? 'rose' : 'fell'
  return `${base} It ${word} from ${pct(early.ai, early.commits)} in the first ${THRESHOLDS.trendMonths} months to ${pct(late.ai, late.commits)} in the last ${THRESHOLDS.trendMonths}, peaking at ${pct(peak.ai, peak.commits)} in ${monthLabel(peak.month)}.${gapText}`
}

function prFinding(model) {
  const p = model.prs
  if (!p.totals.opened) return null
  const fast = share(p.mergedWithinHour, p.mergeSamples)
  const speed = fast >= THRESHOLDS.mergedFastShare
    ? `${pct(p.mergedWithinHour, p.mergeSamples)} were merged within an hour of opening`
    : `the median time from opening to merge was ${hours(p.medianMergeHours)}`
  return `${fmt(p.totals.opened)} pull requests opened, ${pct(p.totals.merged, p.totals.opened)} merged; ${speed} (median ${hours(p.medianMergeHours)}). ${pct(p.singleCommit, p.totals.opened)} contained a single commit, and ${fmt(p.totals.abandoned)} were abandoned.`
}

function excludedFinding(model) {
  const t = model.total
  if (!t.excludedCommits) return null
  const biggest = [...model.excluded].sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved))[0]
  const why = biggest.noise || biggest.giantReason || 'giant'
  return `${fmt(t.excludedCommits)} imports and dumps (${signed(t.excludedAdded, t.excludedRemoved)} authored lines) were set aside; with them, lines written would read ${signed(t.countedAdded, t.countedRemoved)} instead of ${signed(t.added, t.removed)}. The largest was ${biggest.repo} ${biggest.sha.slice(0, 7)} on ${dayLabel(biggest.authorDate.slice(0, 10))} (${signed(biggest.linesAdded, biggest.linesRemoved)}, ${why}).`
}

function rawFinding(model) {
  const s = model.total.setAside
  const raw = s.rawAdded + s.rawRemoved
  const dropped = raw - (model.total.countedAdded + model.total.countedRemoved)
  if (!raw || share(dropped, raw) < THRESHOLDS.setAsideShare) return null
  return `${pct(dropped, raw)} of raw changed lines were not written by hand: lockfiles, generated files, data and named research or vendor folders account for +${fmt(s.rawAdded - model.total.countedAdded)} / −${fmt(s.rawRemoved - model.total.countedRemoved)} raw lines (named folders alone +${fmt(s.pathAdded)} / −${fmt(s.pathRemoved)}). They are left out of every line figure here.`
}

function concentrationFinding(model) {
  const totalCode = model.total.code.added + model.total.code.removed
  const ranked = model.repos.filter((r) => r.tally.commits)
  if (!totalCode || !ranked.length) return null
  const lines = (r) => r.tally.code.added + r.tally.code.removed
  const top = ranked[0]
  const top3 = ranked.slice(0, 3)
  const top3Share = share(top3.reduce((s, r) => s + lines(r), 0), totalCode)
  if (share(lines(top), totalCode) < THRESHOLDS.concentration) {
    return `Code was spread out: the largest repository, ${top.repo}, holds ${pct(lines(top), totalCode)} of changed code lines and the top three ${Math.round(top3Share * 100)}%.`
  }
  return `${top.repo} alone accounts for ${pct(lines(top), totalCode)} of changed code lines; with ${listJoin(top3.slice(1).map((r) => r.repo))} the top three make ${Math.round(top3Share * 100)}%.`
}

function rhythmFinding(model) {
  const { longestRun, longestGap, gapFrom } = model.streaks
  if (!model.total.activeDays) return null
  const gap = longestGap >= THRESHOLDS.gapDays ? ` The longest break was ${fmt(longestGap)} days, after ${dayLabel(gapFrom)}.` : ` No break lasted ${THRESHOLDS.gapDays} days or more (longest ${fmt(longestGap)}).`
  return `Commits landed on ${fmt(model.total.activeDays)} of ${fmt(model.windowDays)} days (${pct(model.total.activeDays, model.windowDays)}); the longest run of consecutive active days was ${fmt(longestRun)}.${gap}`
}

function testsFinding(model) {
  const b = model.total.buckets
  if (!b.code.added) return null
  return `For every 100 code lines added there were ${Math.round((100 * b.tests.added) / b.code.added)} test lines and ${Math.round((100 * b.docs.added) / b.code.added)} documentation lines (tests +${fmt(b.tests.added)}, docs +${fmt(b.docs.added)}).`
}

export function findings(model) {
  const all = [peakMonthFinding, linesPeakFinding, shiftFinding, aiFinding, prFinding, excludedFinding, rawFinding, concentrationFinding, rhythmFinding, testsFinding]
  return all.map((f) => f(model)).filter(Boolean).slice(0, THRESHOLDS.maxFindings)
}
