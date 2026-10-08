import { dayLabel, fmt, hours, monthLabel, pct } from './report-format.mjs'
import { findings, headlines } from './report-findings.mjs'
import { aiLines, biggestDrops, dropKind, eraTable, policyLine } from './report-ai.mjs'
import { methodBullets } from './report-method.mjs'

const num = (n) => fmt(n)
const pair = (a, b) => `${fmt(a)} / ${fmt(b)}`

function monthsTable(model) {
  const partial = new Set(model.partialMonths)
  return {
    head: ['Month', 'Commits', 'AI-made', 'Active days', 'PRs opened', 'PRs merged', 'Lines +', 'Lines −', 'Code +', 'Code −', 'Cumulative code +'],
    align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: model.series.map((m) => [
      `${monthLabel(m.month)}${partial.has(m.month) ? ' (part)' : ''}`,
      num(m.commits), pct(m.ai, m.commits), num(m.activeDays), num(m.prsOpened), num(m.prsMerged),
      num(m.added), num(m.removed), num(m.codeAdded), num(m.codeRemoved), num(m.cumCode),
    ]),
  }
}

function aiMonthsTable(model) {
  return {
    head: ['Month', 'Commits: you / AI', 'Code +: you / AI', 'PRs: you / AI', 'AI share of code'],
    align: ['l', 'r', 'r', 'r', 'r'],
    rows: model.series.map((m) => [
      monthLabel(m.month), pair(m.commits - m.ai, m.ai), pair(m.codeAdded - m.aiCodeAdded, m.aiCodeAdded), pair(m.prsOpened - m.prsAi, m.prsAi), pct(m.aiCodeAdded, m.codeAdded),
    ]),
  }
}

function repoTable(model) {
  return {
    head: ['Repository', 'Commits', 'PRs opened / merged', 'Code + / −', 'Lines + / −', 'Files added / changed / deleted', 'AI-made code'],
    align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: model.repos.map((r) => {
      const t = r.tally
      return [r.repo, num(t.commits), pair(r.prsOpened, r.prsMerged), pair(t.code.added, t.code.removed), pair(t.added, t.removed), `${fmt(t.filesAdded)} / ${fmt(t.filesModified)} / ${fmt(t.filesDeleted)}`, pct(t.aiCode.added, t.code.added)]
    }),
  }
}

function repoDetailTable(model) {
  return {
    head: ['Repository', 'Kind', 'First active', 'Last active', 'Active days', 'Top code directories (lines changed)'],
    align: ['l', 'l', 'l', 'l', 'r', 'l'],
    rows: model.repos.map((r) => [
      r.repo, r.kind, dayLabel(r.tally.first), dayLabel(r.tally.last), num(r.tally.activeDays),
      r.tally.topDirs().map((d) => `${d.dir} (${fmt(d.lines)})`).join(', ') || '–',
    ]),
  }
}

function baselineTable(model) {
  return {
    head: ['Repository', 'Owner history from', 'Commits before', 'Lines + before', 'Code + before', 'Commits this year', 'Lines + this year', 'Code + this year'],
    align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: model.baseline.map((b) => [b.repo, dayLabel(b.baseFirst), num(b.baseCommits), num(b.baseAdded), num(b.baseCode), num(b.yearCommits), num(b.yearAdded), num(b.yearCode)]),
  }
}

function baselineSummary(model) {
  const rows = model.baseline
  if (!rows.length) return 'No repository had owner commits before the window, so there is no baseline.'
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0)
  const first = rows.reduce((d, r) => (r.baseFirst < d ? r.baseFirst : d), rows[0].baseFirst)
  const t = model.total
  return `Before ${dayLabel(model.since)} your history lived in ${fmt(rows.length)} repositories, starting ${dayLabel(first)}: ${fmt(sum('baseCommits'))} commits and +${fmt(sum('baseCode'))} code lines. This year added ${fmt(sum('yearCommits'))} commits and +${fmt(sum('yearCode'))} code lines in those same repositories, and ${fmt(t.commits - sum('yearCommits'))} commits and +${fmt(t.code.added - sum('yearCode'))} code lines everywhere else.`
}

function dropsTable(model) {
  return {
    head: ['Repository', 'Commit', 'Date', 'Subject', 'Code +', 'Lines + / −', 'Kind', 'Label'],
    align: ['l', 'l', 'l', 'l', 'r', 'r', 'l', 'l'],
    rows: biggestDrops(model.counted).map((c) => [
      c.repo, c.sha.slice(0, 7), dayLabel(c.authorDate.slice(0, 10)), c.subject, num(c.buckets?.code?.added || 0), pair(c.linesAdded, c.linesRemoved),
      dropKind(c), c.noise || (c.giant ? `over ${fmt(model.method.giantLines)} lines` : '–'),
    ]),
  }
}

function folderTable(model) {
  return {
    head: ['Repository', 'Excluded folder rules', 'Lines + / − in those folders', 'All generated/data/lockfile lines + / −'],
    align: ['l', 'l', 'r', 'r'],
    rows: model.folderRepos.map((r) => [r.repo, r.rules.join(', ') || 'global rules only', pair(r.pathAdded, r.pathRemoved), pair(r.generatedAdded, r.generatedRemoved)]),
  }
}

function othersLine(model) {
  const o = model.others
  if (!o.commits && !o.prs) return 'No other contributors appear in the window.'
  const names = o.people.slice(0, 5).map((p) => `${p.name} (${fmt(p.commits)} commits, ${fmt(p.prs)} PRs)`).join('; ')
  return `Other contributors in these repositories: ${fmt(o.commits)} counted commits and ${fmt(o.prs)} pull requests from ${fmt(o.people.length)} people — ${names}${o.people.length > 5 ? '; …' : ''}. They are not included anywhere else in this report.`
}

export function buildSections(model) {
  const head = headlines(model)
  return {
    title: 'My coding year',
    subtitle: `${dayLabel(model.since)} – ${dayLabel(model.end)}`,
    headlines: head.lines,
    counting: head.counting,
    aiLines: aiLines(model),
    aiPolicy: policyLine(model),
    eraTable: eraTable(model),
    aiMonths: aiMonthsTable(model),
    findings: findings(model),
    months: monthsTable(model),
    repos: repoTable(model),
    repoDetail: repoDetailTable(model),
    baseline: baselineTable(model),
    baselineSummary: baselineSummary(model),
    drops: dropsTable(model),
    folders: folderTable(model),
    others: othersLine(model),
    method: methodBullets(model),
    prSpeed: `Median time from opening to merge: ${hours(model.prs.medianMergeHours)}.`,
  }
}
