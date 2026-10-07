import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Tally, aggregateCommits, baselineRows, isCounted, isHonest, isOwner, monthOf, monthRange, repoKind, streaks, weekRange,
} from './report-aggregate.mjs'
import { THRESHOLDS, aiTrend, findings, headlines, kindShift, trailerGap } from './report-findings.mjs'
import { compact, niceMax } from './report-charts.mjs'
import { fmt, hours } from './report-format.mjs'
import { buildModel, ownerCheck } from './report-model.mjs'
import { buildSections } from './report-sections.mjs'
import { aggregatePrs, prRole } from './report-prs.mjs'
import { buildReport } from './report.mjs'

const bucket = (code = 0, data = 0) => ({
  code: { added: code, removed: 0 }, tests: { added: 0, removed: 0 }, docs: { added: 0, removed: 0 },
  config: { added: 0, removed: 0 }, generated_or_data: { added: data, removed: 0 }, other: { added: 0, removed: 0 },
})

let seq = 0
function commit(over = {}) {
  seq++
  const code = over.code ?? 10
  const data = over.data ?? 0
  return {
    repo: 'shadow_app_x', sha: `sha${seq}`, authorName: 'A', authorEmail: 'andrey.selikhov@sefe.eu',
    authorDate: '2026-01-15T10:00:00Z', isMerge: false, dupOf: null, dropReason: null, counted: true,
    aiAssisted: false, giant: false, noise: null, linesAdded: code, linesRemoved: 1, rawLinesAdded: code + data, rawLinesRemoved: 1,
    filesAdded: 1, filesModified: 1, filesDeleted: 0, filesRenamed: 0, buckets: bucket(code, data),
    codeDirs: { src: code }, identityClass: 'owner_human', subject: 's', ...over,
  }
}

const SUMMARY = { since: '2025-12-20', until: '2026-02-10', lookbackDays: 60 }

test('month bucketing uses the author local date, not UTC', () => {
  assert.equal(monthOf('2026-01-31T23:30:00-05:00'), '2026-01')
  assert.equal(monthOf('2026-02-01T00:30:00+01:00'), '2026-02')
  assert.deepEqual(monthRange('2025-11-07', '2026-02-03'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(monthRange('2026-03-01', '2026-03-31'), ['2026-03'])
})

test('week range lists every ISO week once with its first in-window day', () => {
  const weeks = weekRange('2026-01-01', '2026-01-12')
  assert.deepEqual(weeks.map((w) => w.week), ['2026-W01', '2026-W02', '2026-W03'])
  assert.equal(weeks[1].start, '2026-01-05')
})

test('owner filtering keeps owner_human and owner_agent only', () => {
  assert.equal(isOwner(commit()), true)
  assert.equal(isOwner(commit({ identityClass: 'owner_agent' })), true)
  assert.equal(isOwner(commit({ identityClass: 'others' })), false)
  assert.equal(isOwner(commit({ identityClass: 'bots' })), false)
  const agg = aggregateCommits([commit(), commit({ identityClass: 'others' }), commit({ identityClass: 'owner_agent' })], { months: ['2026-01'], weeks: [] })
  assert.equal(agg.total.commits, 2)
  assert.equal(agg.total.ai, 1, 'agent identity counts as AI-assisted')
})

test('counted excludes merges, duplicates and cross-repo copies', () => {
  assert.equal(isCounted(commit({ isMerge: true, counted: false, dropReason: 'merge' })), false)
  assert.equal(isCounted(commit({ counted: false, dropReason: 'patch-dup' })), false)
  assert.equal(isCounted(commit({ crossRepoPatchDupOf: 'other:abc' })), false)
  assert.equal(isCounted(commit()), true)
})

test('honest lines skip giant and noise commits but keep them as commits', () => {
  const t = new Tally()
  for (const c of [commit({ code: 100 }), commit({ code: 45000, data: 30000, giant: true }), commit({ code: 7, noise: 'import' })]) t.add(c)
  assert.equal(isHonest(commit({ giant: true })), false)
  assert.equal(t.commits, 3)
  assert.equal(t.added, 100)
  assert.equal(t.code.added, 100)
  assert.equal(t.excludedCommits, 2)
  assert.equal(t.excludedAdded, 45007)
  assert.equal(t.countedAdded, 45107)
  assert.equal(t.setAside.rawAdded - t.countedAdded, 30000, 'generated lines are raw minus authored')
  assert.equal(t.filesAdded, 1)
})

test('streaks report the longest run and the longest gap', () => {
  const s = streaks(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-10', '2026-01-11'])
  assert.deepEqual(s, { longestRun: 3, longestGap: 6, gapFrom: '2026-01-03' })
})

test('PR roles and windowing', () => {
  assert.equal(prRole({ author: { login: 'Drxdre88' } }), 'owner_human')
  assert.equal(prRole({ author: { login: 'andrey.selikhov@sefe.eu' } }), 'owner_human')
  assert.equal(prRole({ author: { login: 'Copilot' } }), 'owner_agent')
  assert.equal(prRole({ author: { login: 'colleague@example.com' } }), 'others')
  const prs = [
    { repo: 'r', status: 'completed', author: { login: 'Drxdre88' }, createdAt: '2026-01-02T10:00:00Z', closedAt: '2026-01-02T10:30:00Z', commitCount: 1 },
    { repo: 'r', status: 'completed', author: { login: 'Drxdre88' }, createdAt: '2026-01-31T10:00:00Z', closedAt: '2026-02-01T12:00:00Z', commitCount: 3 },
    { repo: 'r', status: 'abandoned', author: { login: 'Drxdre88' }, createdAt: '2026-01-03T10:00:00Z', closedAt: null, commitCount: 1 },
    { repo: 'r', status: 'completed', author: { login: 'Drxdre88' }, createdAt: '2025-01-03T10:00:00Z', closedAt: '2025-01-03T11:00:00Z' },
    { repo: 'r', status: 'completed', author: { login: 'Colleague' }, createdAt: '2026-01-05T10:00:00Z', closedAt: '2026-01-05T11:00:00Z' },
  ]
  const agg = aggregatePrs(prs, { since: '2025-12-01', end: '2026-02-28' })
  assert.deepEqual([agg.totals.opened, agg.totals.merged, agg.totals.abandoned], [3, 2, 1])
  assert.deepEqual(agg.byMonth.get('2026-01'), { opened: 3, merged: 1 })
  assert.deepEqual(agg.byMonth.get('2026-02'), { opened: 0, merged: 1 })
  assert.equal(agg.mergedWithinHour, 1)
  assert.equal(agg.others.length, 1)
})

test('baseline rows come only from repos with owner pre-window history', () => {
  const rows = baselineRows({
    lab: { baseline: { before: '2025-10-07', byIdentity: { owner: { commits: 4, linesAdded: 900, linesAddedExclGiant: 90, codeAdded: 50, firstCommit: '2025-03-01T00:00:00Z', lastCommit: '2025-09-01T00:00:00Z' } } } },
    app: { baseline: { byIdentity: { others: { commits: 2 } } } },
    none: { baseline: null },
  }, new Map(), '2025-10-07')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].baseAdded, 90)
  assert.equal(rows[0].yearCommits, 0)
})

function model(commits, prs = []) {
  return buildModel({ commits, summaryAll: SUMMARY, prs })
}

test('repo kind and the labs-to-apps shift threshold', () => {
  assert.equal(repoKind('shadow_app_aeon'), 'app')
  assert.equal(repoKind('kal_el_dash'), 'app')
  assert.equal(repoKind('arcane_dev_lab'), 'lab')
  const early = Array.from({ length: 4 }, () => commit({ repo: 'arcane_dev_lab', authorDate: '2025-12-22T10:00:00Z' }))
  const late = Array.from({ length: 4 }, () => commit({ repo: 'shadow_app_x', authorDate: '2026-02-05T10:00:00Z' }))
  const shifted = model([...early, ...late])
  const s = kindShift(shifted.counted, shifted.months)
  assert.equal(s.firstShare, 0)
  assert.equal(s.secondShare, 1)
  assert.ok(findings(shifted).some((f) => f.startsWith('Work moved from labs towards apps')))
  const flat = model([...early, ...late.map((c) => ({ ...c, repo: 'arcane_ml_lab' }))])
  assert.ok(!findings(flat).some((f) => f.startsWith('Work moved')), 'no shift finding below threshold')
})

test('AI trend and trailer-gap findings respect thresholds', () => {
  const series = [{ ai: 0, commits: 10 }, { ai: 0, commits: 10 }, { ai: 1, commits: 10 }, { ai: 8, commits: 10 }, { ai: 9, commits: 10 }, { ai: 10, commits: 10 }]
  const trend = aiTrend(series, 3)
  assert.ok(trend.delta >= THRESHOLDS.aiTrendPoints)
  const ai = Array.from({ length: 3 }, () => commit({ aiAssisted: true, authorDate: '2026-01-02T10:00:00Z' }))
  const after = Array.from({ length: THRESHOLDS.trailerGapCommits }, () => commit({ authorDate: '2026-01-20T10:00:00Z' }))
  assert.deepEqual(trailerGap([...ai, ...after]), { last: '2026-01-02', after: THRESHOLDS.trailerGapCommits })
  assert.equal(trailerGap([...ai, ...after.slice(1)]), null)
  assert.match(headlines(model([...ai, ...after])).lines[4], /lower bound/)
})

test('excluded and raw set-aside findings cite their numbers', () => {
  const rows = [
    commit({ code: 100, authorDate: '2026-01-05T10:00:00Z' }),
    commit({ code: 0, data: 0, linesAdded: 45000, linesRemoved: 0, giant: true, giantReason: 'authored +45000 > 40000', authorDate: '2026-01-06T10:00:00Z' }),
  ]
  const out = findings(model(rows))
  const excluded = out.find((f) => f.includes('imports and dumps'))
  assert.match(excluded, /\+45,000 \/ −0 authored lines/)
  assert.match(excluded, /authored \+45000 > 40000/)
  assert.ok(!out.some((f) => f.includes('not written by hand')), 'no raw finding when nothing was generated')
  const data = commit({ code: 10, data: 900, linesAdded: 10, rawLinesAdded: 910, excludedAdded: 300, authorDate: '2026-01-07T10:00:00Z' })
  const raw = findings(model([data])).find((f) => f.includes('not written by hand'))
  assert.match(raw, /\+900 \/ −0 raw lines \(named folders alone \+300/)
})

test('owner totals cross-check flags disagreements only', () => {
  const t = new Tally()
  t.add(commit({ code: 10 }))
  assert.deepEqual(ownerCheck(t, { uniqueCommits: 1, lines_counted_excl_giant_noise: { added: 10, removed: 1 }, codeExclGiantNoise: { added: 10, removed: 0 } }), [])
  const issues = ownerCheck(t, { uniqueCommits: 2, lines_counted_excl_giant_noise: { added: 10, removed: 1 } })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /^commits: report 1 vs extractor ownerTotals 2/)
})

test('set-aside sections list sha, reason and excluded-folder rules from config', () => {
  const rows = [
    commit({ repo: 'shadow_app_swarm', code: 10, rawLinesAdded: 510, excludedAdded: 500, data: 500, linesAdded: 10 }),
    commit({ repo: 'shadow_app_swarm', sha: 'abcdef1234', noise: 'snapshot import', linesAdded: 90000 }),
  ]
  const config = { exclude_paths: ['**/gen/**'], repo_overrides: { shadow_app_swarm: { exclude_paths: ['strat_research/**'] } } }
  const m = buildModel({ commits: rows, summaryAll: SUMMARY, config })
  const sec = buildSections(m)
  assert.deepEqual(sec.excluded.rows[0].slice(0, 2), ['shadow_app_swarm', 'abcdef1'])
  assert.equal(sec.excluded.rows[0][6], 'named rule: snapshot import')
  assert.deepEqual(sec.excludedPaths.rows[0].slice(0, 3), ['shadow_app_swarm', 'strat_research/**', '500'])
  assert.ok(sec.method.some((b) => b.includes('"**/gen/**"') && b.includes('shadow_app_swarm: "strat_research/**"')))
  assert.ok(sec.method.some((b) => b.includes('exceed 40,000')))
})

test('concentration finding switches wording at the threshold', () => {
  const one = findings(model([commit({ repo: 'big_app_a', code: 900 }), commit({ repo: 'small_lab', code: 100 })]))
  assert.ok(one.some((f) => f.startsWith('big_app_a alone accounts for 90%')))
  const spread = Array.from({ length: 5 }, (_, i) => commit({ repo: `r${i}_lab`, code: 100 }))
  assert.ok(findings(model(spread)).some((f) => f.startsWith('Code was spread out')))
})

test('formatting helpers', () => {
  assert.equal(fmt(1234567), '1,234,567')
  assert.equal(compact(2500000), '2.5M')
  assert.equal(niceMax(730), 1000)
  assert.equal(niceMax(180), 200)
  assert.equal(hours(0.001), 'under a minute')
})

test('buildReport renders offline HTML and Markdown from a raw directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-'))
  try {
    const rows = [commit({ code: 1200 }), commit({ identityClass: 'others', authorEmail: 'colleague@x', authorName: 'Colleague' })]
    writeFileSync(join(dir, 'commits.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'))
    writeFileSync(join(dir, 'summary.all.json'), JSON.stringify(SUMMARY))
    const { html, markdown, sections } = buildReport({ raw: dir, prs: null })
    assert.match(sections.headlines[0], /^1 commits/)
    assert.match(html, /<svg class="chart"/)
    assert.doesNotMatch(html, /<script|https?:\/\/(?!www\.w3\.org)/)
    assert.match(markdown, /\| shadow_app_x \| 1 \|/)
    assert.match(markdown, /Other contributors in these repositories: 1 counted commits/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
