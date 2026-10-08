import { dayLabel, fmt, hours, listJoin, monthLabel, pct, share, signed } from './report-format.mjs'
import { monthOf, repoKind } from './report-aggregate.mjs'
import { aiFindings, aiScale, biggestDrops, dropKind } from './report-ai.mjs'

export const THRESHOLDS = {
  driverShare: 0.25,
  shiftPoints: 0.2,
  mergedFastShare: 0.5,
  rawShare: 0.25,
  concentration: 0.3,
  gapDays: 14,
  maxFindings: 10,
}

export function busiestMonth(series) {
  return series.reduce((best, m) => (m.commits > (best?.commits ?? -1) ? m : best), null)
}

export function headlines(model) {
  const t = model.total
  const p = model.prs.totals
  const busy = busiestMonth(model.series)
  const s = aiScale(model)
  const era = model.eraStart ? ` Copilot commits as you from ${dayLabel(model.eraStart)}, so everything from that date counts as AI-made; before it, trailers and agent identities.` : ''
  const lines = [
    `+${fmt(t.code.added)} lines of code written (−${fmt(t.code.removed)} removed) in ${fmt(t.commits)} commits on ${fmt(t.activeDays)} active days across ${fmt(model.repos.filter((r) => r.tally.commits).length)} repositories, ${dayLabel(model.since)} to ${dayLabel(model.end)}.`,
    `With tests: +${fmt(t.codeAndTests.added)}. With docs and config as well: +${fmt(t.added)} authored lines. In raw git terms, including generated files and data: +${fmt(t.rawAdded)} / −${fmt(t.rawRemoved)}.`,
    `${fmt(p.opened)} pull requests opened and ${fmt(p.merged)} merged.`,
    `AI made ${pct(s.code, t.code.added)} of the code (+${fmt(s.code)} lines), ${pct(s.commits, t.commits)} of commits and ${pct(s.prs, p.opened)} of pull requests.${era}`,
    `${fmt(t.filesAdded)} files added, ${fmt(t.filesModified)} changed and ${fmt(t.filesDeleted)} deleted (${fmt(t.filesRenamed)} renamed).`,
  ]
  if (busy?.commits) lines.push(`Busiest month: ${monthLabel(busy.month)}, with ${fmt(busy.commits)} commits and +${fmt(busy.codeAdded)} lines of code.`)
  const counting = 'Everything you committed counts, including imports, vendored engines and big features. Only exact duplicates are removed: merge commits, rebased or cherry-picked copies, squash-merge repeats and copies across repositories.'
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
    .filter((c) => monthOf(c.authorDate) === top.month)
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

function prFinding(model) {
  const p = model.prs
  if (!p.totals.opened) return null
  const fast = share(p.mergedWithinHour, p.mergeSamples)
  const speed = fast >= THRESHOLDS.mergedFastShare
    ? `${pct(p.mergedWithinHour, p.mergeSamples)} were merged within an hour of opening`
    : `the median time from opening to merge was ${hours(p.medianMergeHours)}`
  return `${fmt(p.totals.opened)} pull requests opened, ${pct(p.totals.merged, p.totals.opened)} merged; ${speed} (median ${hours(p.medianMergeHours)}). ${pct(p.singleCommit, p.totals.opened)} contained a single commit, and ${fmt(p.totals.abandoned)} were abandoned.`
}

function dropsFinding(model) {
  const drops = biggestDrops(model.counted)
  const code = model.total.code.added
  if (!drops.length || !code) return null
  const dropCode = drops.reduce((sum, c) => sum + (c.buckets?.code?.added || 0), 0)
  const top = drops[0]
  return `The ${fmt(drops.length)} biggest single commits hold +${fmt(dropCode)} code lines (${pct(dropCode, code)} of all code). The largest was ${top.repo} ${top.sha.slice(0, 7)} on ${dayLabel(top.authorDate.slice(0, 10))} (+${fmt(top.linesAdded)} / −${fmt(top.linesRemoved)}, ${dropKind(top)}).`
}

function rawFinding(model) {
  const t = model.total
  const raw = t.rawAdded + t.rawRemoved
  const other = raw - (t.added + t.removed)
  if (!raw || share(other, raw) < THRESHOLDS.rawShare) return null
  const folders = t.pathAdded || t.pathRemoved ? ` and excluded folders (those alone +${fmt(t.pathAdded)} / −${fmt(t.pathRemoved)})` : ''
  return `In raw git terms the year moved +${fmt(t.rawAdded)} / −${fmt(t.rawRemoved)} lines; ${pct(other, raw)} of that was lockfiles, generated files and data${folders}, counted only in the raw figure.`
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
  const all = [peakMonthFinding, linesPeakFinding, aiFindings, shiftFinding, prFinding, dropsFinding, rawFinding, concentrationFinding, rhythmFinding, testsFinding]
  return all.flatMap((f) => f(model)).filter(Boolean).slice(0, THRESHOLDS.maxFindings)
}
