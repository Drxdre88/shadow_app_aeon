import { GIANT_LINES } from './log-parse.mjs'
import { DATA_DUMP_LINES } from './classify.mjs'
import { localDay } from './summary.mjs'
import { fmt } from './report-format.mjs'
import {
  Tally, addDays, aggregateCommits, baselineRows, isCounted, monthRange, monthlySeries, repoKind, streaks, weekRange,
} from './report-aggregate.mjs'
import { aggregatePrs, otherContributors } from './report-prs.mjs'

function endDay({ summaryAll, commits, prs }) {
  if (summaryAll.until) return summaryAll.until
  let end = summaryAll.since
  for (const c of commits) end = localDay(c.authorDate) > end ? localDay(c.authorDate) : end
  for (const pr of prs) end = localDay(pr.createdAt) > end ? localDay(pr.createdAt) : end
  return end
}

function repoRows(agg, prAgg) {
  const names = new Set([...agg.byRepo.keys(), ...prAgg.byRepo.keys()])
  return [...names].map((repo) => {
    const t = agg.byRepo.get(repo) || new Tally()
    const pr = prAgg.byRepo.get(repo) || { opened: 0, merged: 0 }
    return { repo, kind: repoKind(repo), tally: t, prsOpened: pr.opened, prsMerged: pr.merged, months: agg.repoMonths.get(repo) || new Map() }
  }).sort((a, b) => b.tally.code.added + b.tally.code.removed - (a.tally.code.added + a.tally.code.removed) || b.tally.commits - a.tally.commits || (a.repo < b.repo ? -1 : 1))
}

function methodFacts({ run, repoSummaries, agg, summaryAll, config }) {
  const repos = run.repos || []
  const warnings = []
  for (const r of repos) for (const w of r.warnings || []) warnings.push(`${r.repo}: ${w}`)
  for (const r of repos) if (r.status !== 'ok') warnings.push(`${r.repo}: ${r.error || r.status}`)
  const noiseReasons = new Map()
  for (const c of agg.excluded) {
    const reason = c.noise ? `named rule: ${c.noise}` : `giant (authored lines added or removed > ${fmt(GIANT_LINES)})`
    noiseReasons.set(reason, (noiseReasons.get(reason) || 0) + 1)
  }
  const ownerEmails = new Map()
  for (const c of agg.owner) {
    const k = `${c.identityClass}: ${c.authorEmail}`
    ownerEmails.set(k, (ownerEmails.get(k) || 0) + 1)
  }
  return {
    reposScanned: repos.length || Object.keys(repoSummaries).length,
    reposOk: repos.filter((r) => r.status === 'ok').length,
    refs: repos.reduce((t, r) => t + (r.refCount || 0), 0),
    scannedCommits: repos.reduce((t, r) => t + (r.scannedCommits || 0), 0),
    lookbackDays: summaryAll.lookbackDays,
    squashChecked: repos.reduce((t, r) => t + (r.squash?.checked || 0), 0),
    squashMatched: repos.reduce((t, r) => t + (r.squash?.matched || 0), 0),
    giantLines: GIANT_LINES,
    dataDumpLines: DATA_DUMP_LINES,
    warnings,
    noiseReasons: [...noiseReasons.entries()],
    ownerEmails: [...ownerEmails.entries()].sort((a, b) => b[1] - a[1]),
    globalExcludes: config?.exclude_paths || [],
    repoExcludes: Object.entries(config?.repo_overrides || {}).filter(([, o]) => o.exclude_paths?.length).map(([repo, o]) => [repo, o.exclude_paths]),
    configPath: config?.path || null,
  }
}

export function ownerCheck(total, ownerTotals) {
  if (!ownerTotals) return []
  const pairs = [
    ['commits', total.commits, ownerTotals.uniqueCommits],
    ['authored lines added', total.added, ownerTotals.lines_counted_excl_giant_noise?.added],
    ['authored lines removed', total.removed, ownerTotals.lines_counted_excl_giant_noise?.removed],
    ['code lines added', total.code.added, ownerTotals.codeExclGiantNoise?.added],
    ['code lines removed', total.code.removed, ownerTotals.codeExclGiantNoise?.removed],
  ]
  return pairs.filter(([, mine, theirs]) => theirs != null && mine !== theirs).map(([name, mine, theirs]) => `${name}: report ${fmt(mine)} vs extractor ownerTotals ${fmt(theirs)}`)
}

function setAsideRows(agg, method) {
  const rules = new Map(method.repoExcludes)
  return [...agg.byRepo.entries()]
    .map(([repo, t]) => ({ repo, rules: [...(rules.get(repo) || [])], ...t.setAside, setAsideCommits: t.excludedCommits }))
    .filter((r) => r.pathAdded || r.pathRemoved || r.rules.length)
    .sort((a, b) => b.pathAdded + b.pathRemoved - (a.pathAdded + a.pathRemoved) || (a.repo < b.repo ? -1 : 1))
}

export function buildModel({ commits, summaryAll, run = { repos: [] }, repoSummaries = {}, prs = [], prSummary = null, config = null }) {
  const since = summaryAll.since
  const end = endDay({ summaryAll, commits, prs })
  const months = monthRange(since, end)
  const weeks = weekRange(since, end)
  const agg = aggregateCommits(commits, { months, weeks })
  const prAgg = aggregatePrs(prs, { since, end })
  const series = monthlySeries(months, agg.byMonth, prAgg.byMonth)
  const sortedDays = [...agg.total.days].sort()
  const method = methodFacts({ run, repoSummaries, agg, summaryAll, config })
  return {
    since,
    end,
    months,
    partialMonths: [since.slice(8) !== '01' ? months[0] : null, addDays(end, 1).slice(8) !== '01' ? months[months.length - 1] : null].filter(Boolean),
    counted: agg.counted,
    weeks: weeks.map((w) => ({ ...w, commits: agg.byWeek.get(w.week) || 0 })),
    total: agg.total,
    dedupe: agg.dedupe,
    excluded: agg.excluded,
    series,
    repos: repoRows(agg, prAgg),
    baseline: baselineRows(repoSummaries, agg.byRepo, since),
    prs: prAgg,
    others: otherContributors(commits, prAgg.others, { isCounted }),
    streaks: streaks(sortedDays),
    windowDays: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000) + 1,
    method,
    setAsideRepos: setAsideRows(agg, method),
    ownerCheck: ownerCheck(agg.total, summaryAll.ownerTotals),
    prNotes: (prSummary?.repos || []).filter((r) => r.error || r.note).map((r) => `${r.repo}: ${r.error || r.note}`),
  }
}
