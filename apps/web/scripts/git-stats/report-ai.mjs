import { localDay } from './summary.mjs'
import { addDays, daysBetween } from './report-aggregate.mjs'
import { dayLabel, fmt, pct, share } from './report-format.mjs'

export const REASON_LABELS = { agent_identity: 'agent identity', trailer: 'co-author trailer', agent_era: 'agent era (from start date)' }

const ratio = (a, b) => (b ? a / b : null)
const times = (x) => (x == null ? '–' : `${x.toFixed(1)}×`)
const rate = (x, digits = 1) => (x == null ? '–' : x >= 100 ? fmt(x) : x.toFixed(digits))

export function periodStats(counted, ownerPrs, from, to) {
  const inRange = (day) => day >= from && day <= to
  const commits = counted.filter((c) => inRange(localDay(c.authorDate)))
  const days = new Set(commits.map((c) => localDay(c.authorDate)))
  const calendarDays = daysBetween(from, to) + 1
  const code = commits.reduce((t, c) => t + (c.buckets?.code?.added || 0), 0)
  const prs = ownerPrs.filter((pr) => inRange(localDay(pr.createdAt))).length
  return {
    from, to, calendarDays, activeDays: days.size, commits: commits.length, code, prs,
    codePerActiveDay: ratio(code, days.size),
    commitsPerDay: ratio(commits.length, calendarDays),
    prsPerWeek: ratio(7 * prs, calendarDays),
  }
}

export function eraComparison(model) {
  const era = model.eraStart
  if (!era || era <= model.since || era > model.end) return null
  const before = periodStats(model.counted, model.prs.owner, model.since, addDays(era, -1))
  const after = periodStats(model.counted, model.prs.owner, era, model.end)
  const mult = (k) => (before[k] && after[k] != null ? after[k] / before[k] : null)
  return { before, after, multipliers: { codePerActiveDay: mult('codePerActiveDay'), commitsPerDay: mult('commitsPerDay'), prsPerWeek: mult('prsPerWeek') } }
}

export function aiScale(model) {
  const t = model.total
  const p = model.prs.totals
  return {
    commits: t.ai, commitShare: share(t.ai, t.commits), code: t.aiCode.added, codeRemoved: t.aiCode.removed,
    codeShare: share(t.aiCode.added, t.code.added), authored: t.aiAdded, reasons: t.aiReasons,
    prs: p.ai, prShare: share(p.ai, p.opened),
  }
}

export function policyLine(model) {
  if (!model.eraStart) return 'AI-made means a commit by an agent identity or one carrying an AI co-author trailer; no agent-era start date was configured.'
  return `Assumption: Copilot commits and opens pull requests under your name, so every commit and pull request of yours from ${dayLabel(model.eraStart)} (the first Copilot CLI session on this PC) counts as AI-made. Before that date only agent identities and AI co-author trailers count.`
}

export function aiLines(model) {
  const s = aiScale(model)
  const cmp = eraComparison(model)
  const lines = [
    `AI made +${fmt(s.code)} of +${fmt(model.total.code.added)} code lines (${pct(s.code, model.total.code.added)}), ${fmt(s.commits)} of ${fmt(model.total.commits)} commits (${pct(s.commits, model.total.commits)}) and ${fmt(s.prs)} of ${fmt(model.prs.totals.opened)} pull requests (${pct(s.prs, model.prs.totals.opened)}).`,
    `By reason: ${Object.entries(s.reasons).filter(([, n]) => n).map(([r, n]) => `${REASON_LABELS[r] || r} ${fmt(n)}`).join(', ') || 'none'}.`,
  ]
  if (cmp) {
    const m = cmp.multipliers
    lines.push(`Since ${dayLabel(model.eraStart)} you ship ${times(m.codePerActiveDay)} the code per active day, ${times(m.commitsPerDay)} the commits per day and ${times(m.prsPerWeek)} the pull requests per week of the ${fmt(cmp.before.calendarDays)} days before.`)
  }
  return lines
}

export function eraTable(model) {
  const cmp = eraComparison(model)
  if (!cmp) return { head: [], align: [], rows: [] }
  const { before: b, after: a, multipliers: m } = cmp
  const row = (label, x, y, mult, digits) => [label, rate(x, digits), rate(y, digits), times(mult)]
  return {
    head: ['', `Before (${dayLabel(b.from)} – ${dayLabel(b.to)})`, `Agent era (${dayLabel(a.from)} – ${dayLabel(a.to)})`, 'Multiplier'],
    align: ['l', 'r', 'r', 'r'],
    rows: [
      ['Calendar days / active days', `${fmt(b.calendarDays)} / ${fmt(b.activeDays)}`, `${fmt(a.calendarDays)} / ${fmt(a.activeDays)}`, ''],
      ['Commits / code lines added / PRs opened', `${fmt(b.commits)} / ${fmt(b.code)} / ${fmt(b.prs)}`, `${fmt(a.commits)} / ${fmt(a.code)} / ${fmt(a.prs)}`, ''],
      row('Code lines per active day', b.codePerActiveDay, a.codePerActiveDay, m.codePerActiveDay, 0),
      row('Commits per calendar day', b.commitsPerDay, a.commitsPerDay, m.commitsPerDay, 1),
      row('Pull requests per week', b.prsPerWeek, a.prsPerWeek, m.prsPerWeek, 1),
    ],
  }
}

export function aiFindings(model) {
  const s = aiScale(model)
  const out = []
  if (model.total.code.added) {
    const era = s.reasons.agent_era ? ` ${fmt(s.reasons.agent_era)} of those commits count only because they fall in the agent era (from ${dayLabel(model.eraStart)}); ${fmt(s.commits - s.reasons.agent_era)} carry a trailer or agent identity.` : ''
    out.push(`AI made ${pct(s.code, model.total.code.added)} of all code (+${fmt(s.code)} lines) and ${pct(s.commits, model.total.commits)} of commits.${era}`)
  }
  const cmp = eraComparison(model)
  if (cmp && cmp.multipliers.codePerActiveDay != null) {
    out.push(`In the agent era code output per active day is ${times(cmp.multipliers.codePerActiveDay)} the earlier average (${fmt(cmp.after.codePerActiveDay)} vs ${fmt(cmp.before.codePerActiveDay)} lines); the ${fmt(cmp.after.calendarDays)} era days produced ${pct(cmp.after.code, cmp.after.code + cmp.before.code)} of the year's code.`)
  }
  return out
}

export function dropKind(c) {
  const text = `${c.noise || ''} ${c.subject || ''}`.toLowerCase()
  if (/vendor/.test(text)) return 'vendored'
  if (c.noise) return 'import'
  return c.linesRemoved > c.linesAdded ? 'deletion' : 'feature'
}

export function biggestDrops(counted, n = 15) {
  return [...counted]
    .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved) || (a.sha < b.sha ? -1 : 1))
    .slice(0, n)
}
