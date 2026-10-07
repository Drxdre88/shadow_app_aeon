import { dayLabel, fmt, hours, monthLabel, pct } from './report-format.mjs'
import { findings, headlines, trailerGap } from './report-findings.mjs'

const num = (n) => fmt(n)
const pair = (a, b) => `${fmt(a)} / ${fmt(b)}`

function monthsTable(model) {
  const partial = new Set(model.partialMonths)
  return {
    head: ['Month', 'Commits', 'AI-assisted', 'Active days', 'PRs opened', 'PRs merged', 'Lines +', 'Lines −', 'Code +', 'Code −', 'Cumulative +'],
    align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: model.series.map((m) => [
      `${monthLabel(m.month)}${partial.has(m.month) ? ' (part)' : ''}`,
      num(m.commits), pct(m.ai, m.commits), num(m.activeDays), num(m.prsOpened), num(m.prsMerged),
      num(m.added), num(m.removed), num(m.codeAdded), num(m.codeRemoved), num(m.cumAdded),
    ]),
  }
}

function repoTable(model) {
  return {
    head: ['Repository', 'Commits', 'PRs opened / merged', 'Lines + / −', 'Code + / −', 'Files added / changed / deleted', 'AI-assisted'],
    align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
    rows: model.repos.map((r) => {
      const t = r.tally
      return [r.repo, num(t.commits), pair(r.prsOpened, r.prsMerged), pair(t.added, t.removed), pair(t.code.added, t.code.removed), `${fmt(t.filesAdded)} / ${fmt(t.filesModified)} / ${fmt(t.filesDeleted)}`, pct(t.ai, t.commits)]
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
    head: ['Repository', 'Owner history from', 'Commits before', 'Lines + before (excl. giant)', `Code + before (${model.baseline.every((b) => b.baseCodeExclGiant) ? 'excl.' : 'incl.'} giant)`, 'Commits this year', 'Lines + this year', 'Code + this year'],
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

function excludedTable(model) {
  return {
    head: ['Repository', 'Commit', 'Date', 'Subject', 'Authored +', 'Authored −', 'Reason'],
    align: ['l', 'l', 'l', 'l', 'r', 'r', 'l'],
    rows: [...model.excluded].sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved)).map((c) => [
      c.repo, c.sha.slice(0, 7), dayLabel(c.authorDate.slice(0, 10)), c.subject, num(c.linesAdded), num(c.linesRemoved),
      c.noise ? `named rule: ${c.noise}` : `giant: ${c.giantReason || `over ${fmt(model.method.giantLines)} authored lines`}`,
    ]),
  }
}

function excludedPathTable(model) {
  return {
    head: ['Repository', 'Excluded folder rules', 'Lines + in excluded folders', 'Lines − in excluded folders', 'All generated/data/lockfile lines + / −'],
    align: ['l', 'l', 'r', 'r', 'r'],
    rows: model.setAsideRepos.map((r) => [
      r.repo, r.rules.join(', ') || 'global rules only', num(r.pathAdded), num(r.pathRemoved), pair(r.generatedAdded, r.generatedRemoved),
    ]),
  }
}

function othersLine(model) {
  const o = model.others
  if (!o.commits && !o.prs) return 'No other contributors appear in the window.'
  const names = o.people.slice(0, 5).map((p) => `${p.name} (${fmt(p.commits)} commits, ${fmt(p.prs)} PRs)`).join('; ')
  return `Other contributors in these repositories: ${fmt(o.commits)} counted commits and ${fmt(o.prs)} pull requests from ${fmt(o.people.length)} people — ${names}${o.people.length > 5 ? '; …' : ''}. They are not included anywhere else in this report.`
}

function methodBullets(model) {
  const m = model.method
  const d = model.dedupe
  const t = model.total
  const aiGap = trailerGap(model.counted)
  const out = [
    `Window: commits authored ${dayLabel(model.since)} to ${dayLabel(model.end)} (author's local date). ${fmt(m.reposOk)} of ${fmt(m.reposScanned)} repositories read; ${fmt(m.refs)} branches and remote-tracking refs scanned (all local branches and remotes, not just main), ${fmt(m.scannedCommits)} commits read including a ${fmt(m.lookbackDays)}-day lookback used only for duplicate detection.`,
    `Your identities (${fmt(d.seen)} commits seen): ${m.ownerEmails.map(([k, n]) => `${k} (${fmt(n)})`).join(', ')}. "AI-assisted" means a Claude/Anthropic/Copilot co-author trailer or an agent identity.`,
    `Deduplication: ${fmt(d.merges)} merge commits, ${fmt(d.patchDup)} rebased or cherry-picked copies (same patch id), ${fmt(d.squashDup)} branch commits already represented by a squash merge, ${fmt(d.squashBranch)} squash merges whose branch commits were counted instead, and ${fmt(d.crossRepo)} copies of a change already counted in another repository were dropped, leaving ${fmt(d.counted)} counted commits.`,
    `Squash rule: a squash merge is matched to its pull request (or, without PR data, to a branch with the same patch); ${fmt(m.squashMatched)} of ${fmt(m.squashChecked)} candidate branches matched. When the branch commits survive, they are counted and the squash commit is not, so work is never counted twice.`,
    `Authored lines: every line figure counts lines you wrote, not raw diff lines. Lockfiles, generated files, data files (csv, parquet, ipynb, …), large json/yaml/xml/txt changes and named research or vendor folders are left out; across your counted commits that removed +${fmt(t.setAside.rawAdded - t.countedAdded)} / −${fmt(t.setAside.rawRemoved - t.countedRemoved)} raw lines, ${fmt(t.setAside.pathAdded)} / ${fmt(t.setAside.pathRemoved)} of them in named folders.`,
    `Named folder rules: everywhere ${m.globalExcludes.map((g) => `"${g}"`).join(', ') || 'none'}; ${m.repoExcludes.map(([repo, globs]) => `${repo}: ${globs.map((g) => `"${g}"`).join(', ')}`).join('; ') || 'no per-repository rules'}${m.configPath ? ` (from ${m.configPath.replace(/\\/g, '/').split('/').slice(-1)[0]})` : ''}.`,
    `Set aside: a commit is kept out of line and file totals when its authored lines added or removed exceed ${fmt(m.giantLines)} ("giant") or it matches a named per-repository rule (imports, snapshots, vendored engines, data dumps). It still counts as a commit and an active day. ${fmt(t.excludedCommits)} commits were set aside (${m.noiseReasons.map(([r, n]) => `${r}: ${fmt(n)}`).join('; ')}).`,
    `Buckets: each file is classified as code, tests, docs, config, generated/data or other by path and extension. Lockfiles, vendored and build folders, data formats (csv, parquet, ipynb, …) and json/yaml/xml/txt files with more than ${fmt(m.dataDumpLines)} changed lines go to generated/data.`,
    `Pull requests: opened in the window by andrey.selikhov@sefe.eu (Azure DevOps) or Drxdre88 (GitHub), plus ${fmt(model.prs.totals.agent)} opened by the Copilot agent. "Merged" means completed; merge month is the close date.`,
    `Repository kind: names containing "_app_" or ending "_dash" are apps; names ending "_lab" are labs.`,
    `Baseline: owner commits before the window, merges excluded but no patch or squash dedupe. Lines are authored lines with giant commits left out${model.baseline.every((b) => b.baseCodeExclGiant) ? ', and so are code lines' : '; code lines include giant commits'}. Treat it as approximate.`,
    `AI-assisted is a lower bound: it is only visible when a co-author trailer was written or an agent identity committed.${aiGap ? ` No trailer appears after ${dayLabel(aiGap.last)} although ${fmt(aiGap.after)} commits followed.` : ''} Hangar missions also commit under your own identity, so agent work there reads as unassisted.`,
    'Known limits: Azure DevOps PRs carry no line counts; author dates are in mixed time zones; files "changed" counts modifications and renames are listed separately; file counts leave out set-aside commits.',
  ]
  for (const w of [...m.warnings, ...model.prNotes]) out.push(`Data note — ${w}.`)
  for (const w of model.ownerCheck) out.push(`Data note — this report and the extractor's owner totals disagree on ${w}.`)
  return out
}

export function buildSections(model) {
  const head = headlines(model)
  return {
    title: 'My coding year',
    subtitle: `${dayLabel(model.since)} – ${dayLabel(model.end)}`,
    headlines: head.lines,
    counting: head.counting,
    findings: findings(model),
    months: monthsTable(model),
    repos: repoTable(model),
    repoDetail: repoDetailTable(model),
    baseline: baselineTable(model),
    baselineSummary: baselineSummary(model),
    excluded: excludedTable(model),
    excludedPaths: excludedPathTable(model),
    others: othersLine(model),
    method: methodBullets(model),
    prSpeed: `Median time from opening to merge: ${hours(model.prs.medianMergeHours)}.`,
  }
}
