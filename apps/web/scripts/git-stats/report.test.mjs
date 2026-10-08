import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Tally, aggregateCommits, aiReasonOf, baselineRows, isCounted, isOwner, monthOf, monthRange, repoKind, streaks, weekRange,
} from './report-aggregate.mjs'
import { THRESHOLDS, findings, headlines, kindShift } from './report-findings.mjs'
import { aiFindings, aiScale, biggestDrops, dropKind, eraComparison } from './report-ai.mjs'
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

test('every counted commit counts in full; big commits are only flagged', () => {
  const t = new Tally()
  for (const c of [commit({ code: 100 }), commit({ code: 45000, data: 30000, giant: true }), commit({ code: 7, noise: 'import' })]) t.add(c)
  assert.equal(t.commits, 3)
  assert.equal(t.added, 45107)
  assert.equal(t.code.added, 45107)
  assert.equal(t.flaggedCommits, 2)
  assert.equal(t.flaggedCode, 45007)
  assert.equal(t.rawAdded - t.added, 30000, 'generated lines are raw minus authored')
  assert.equal(t.filesAdded, 3)
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
  assert.deepEqual([agg.totals.opened, agg.totals.merged, agg.totals.abandoned, agg.totals.ai], [3, 2, 1, 0])
  assert.deepEqual(agg.byMonth.get('2026-01'), { opened: 3, merged: 1, aiOpened: 0 })
  assert.deepEqual(agg.byMonth.get('2026-02'), { opened: 0, merged: 1, aiOpened: 0 })
  assert.equal(agg.mergedWithinHour, 1)
  assert.equal(agg.others.length, 1)
  const era = aggregatePrs(prs, { since: '2025-12-01', end: '2026-02-28', eraStart: '2026-01-31' })
  assert.equal(era.totals.ai, 1, 'owner PRs from the era start count as AI-made')
  assert.equal(era.byMonth.get('2026-01').aiOpened, 1)
  assert.equal(aggregatePrs([{ ...prs[0], author: { login: 'Copilot' } }], { since: '2025-12-01', end: '2026-02-28' }).totals.ai, 1)
})

test('baseline rows come only from repos with owner pre-window history', () => {
  const rows = baselineRows({
    lab: { baseline: { before: '2025-10-07', byIdentity: { owner: { commits: 4, linesAdded: 900, linesAddedExclGiant: 90, codeAdded: 50, codeAddedInclGiant: 500, firstCommit: '2025-03-01T00:00:00Z', lastCommit: '2025-09-01T00:00:00Z' } } } },
    app: { baseline: { byIdentity: { others: { commits: 2 } } } },
    none: { baseline: null },
  }, new Map(), '2025-10-07')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].baseAdded, 900, 'baseline includes big commits like the year figures')
  assert.equal(rows[0].baseCode, 500)
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

test('AI attribution prefers extractor fields and falls back to identity, trailer and era date', () => {
  assert.equal(aiReasonOf(commit({ aiAttributed: true, aiReason: 'agent_era' }), null), 'agent_era')
  assert.equal(aiReasonOf(commit({ aiAttributed: false, aiReason: null, aiAssisted: true }), '2026-01-01'), null, 'extractor verdict wins')
  assert.equal(aiReasonOf(commit({ identityClass: 'owner_agent' })), 'agent_identity')
  assert.equal(aiReasonOf(commit({ aiAssisted: true })), 'trailer')
  assert.equal(aiReasonOf(commit({ authorDate: '2026-01-15T10:00:00Z' }), '2026-01-15'), 'agent_era')
  assert.equal(aiReasonOf(commit({ authorDate: '2026-01-14T23:00:00Z' }), '2026-01-15'), null)
  assert.equal(aiReasonOf(commit({ identityClass: 'others', authorDate: '2026-02-01T10:00:00Z' }), '2026-01-15'), null)
})

test('agent-era comparison and AI findings come from the data', () => {
  const before = [commit({ code: 100, authorDate: '2026-01-05T10:00:00Z' }), commit({ code: 100, authorDate: '2026-01-06T10:00:00Z', aiAssisted: true })]
  const after = [commit({ code: 600, authorDate: '2026-01-20T10:00:00Z' }), commit({ code: 600, authorDate: '2026-01-20T12:00:00Z' })]
  const m = buildModel({ commits: [...before, ...after], summaryAll: SUMMARY, config: { agent_era_start: '2026-01-15' } })
  const s = aiScale(m)
  assert.deepEqual([s.commits, s.code, s.reasons.trailer, s.reasons.agent_era], [3, 1300, 1, 2])
  const cmp = eraComparison(m)
  assert.equal(cmp.before.codePerActiveDay, 100)
  assert.equal(cmp.after.codePerActiveDay, 1200)
  assert.equal(cmp.multipliers.codePerActiveDay, 12)
  const out = aiFindings(m)
  assert.match(out[0], /^AI made 93% of all code \(\+1,300 lines\)/)
  assert.match(out[1], /12\.0× the earlier average/)
  assert.match(headlines(m).lines[3], /Copilot commits as you from 15 Jan 2026/)
  assert.equal(eraComparison(model(before)), null, 'no era comparison without a start date')
})

test('biggest drops are labelled but nothing is excluded', () => {
  const rows = [
    commit({ code: 5, linesAdded: 90000, sha: 'aaaaaaa1', noise: 'snapshot import' }),
    commit({ code: 5, linesAdded: 80000, sha: 'bbbbbbb2', noise: 'vendored BSAD engine' }),
    commit({ code: 70000, sha: 'ccccccc3', giant: true }),
    commit({ code: 10, sha: 'ddddddd4' }),
  ]
  assert.deepEqual(biggestDrops(rows, 3).map(dropKind), ['import', 'vendored', 'feature'])
  assert.equal(dropKind(commit({ linesAdded: 12, linesRemoved: 62758 })), 'deletion')
  const m = model(rows)
  assert.equal(m.total.added, 90000 + 80000 + 70000 + 10)
  const sec = buildSections(m)
  assert.deepEqual(sec.drops.rows[0].slice(0, 2), ['shadow_app_x', 'aaaaaaa'])
  assert.deepEqual(sec.drops.rows[0].slice(6), ['import', 'snapshot import'])
  assert.ok(findings(m).some((f) => /^The 4 biggest single commits hold \+70,020 code lines \(100% of all code\)/.test(f)))
})

test('raw finding needs the generated share threshold and cites named folders', () => {
  assert.ok(!findings(model([commit({ code: 100 })])).some((f) => f.startsWith('In raw git terms')))
  const data = commit({ code: 10, data: 900, excludedAdded: 300 })
  const raw = findings(model([data])).find((f) => f.startsWith('In raw git terms'))
  assert.match(raw, /\+910 \/ −1 lines; 99% of that .*excluded folders \(those alone \+300/)
  const plain = findings(model([commit({ code: 10, data: 900 })])).find((f) => f.startsWith('In raw git terms'))
  assert.doesNotMatch(plain, /excluded folders/, 'no folder clause when nothing sits in excluded folders')
})

test('owner totals cross-check uses the all-inclusive fields', () => {
  const t = new Tally()
  t.add({ ...commit({ code: 10 }), aiReason_: 'trailer' })
  const ok = { uniqueCommits: 1, authoredAddedAll: 10, authoredRemovedAll: 1, codeAddedAll: 10, codeRemovedAll: 0, aiAttributedCommits: 1, aiAttributedCodeAdded: 10 }
  assert.deepEqual(ownerCheck(t, ok), [])
  const issues = ownerCheck(t, { ...ok, codeAddedAll: 12 })
  assert.deepEqual(issues, ['code lines added: report 10 vs extractor ownerTotals 12'])
})

test('method lists folder rules from config and states only duplicates are removed', () => {
  const rows = [commit({ repo: 'shadow_app_swarm', code: 10, data: 500, excludedAdded: 500 })]
  const config = { exclude_paths: ['**/gen/**'], repo_overrides: { shadow_app_swarm: { exclude_paths: ['strat_research/**'] } }, agent_era_start: '2026-01-01' }
  const sec = buildSections(buildModel({ commits: rows, summaryAll: SUMMARY, config }))
  assert.deepEqual(sec.folders.rows[0].slice(0, 3), ['shadow_app_swarm', 'strat_research/**', '500 / 0'])
  assert.ok(sec.method.some((b) => b.includes('"**/gen/**"') && b.includes('shadow_app_swarm: "strat_research/**"')))
  assert.ok(sec.method.some((b) => b.startsWith('Only exact duplicates are removed')))
  assert.ok(!sec.method.some((b) => /lower bound|set aside/i.test(b)))
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
    assert.match(sections.headlines[0], /^\+1,200 lines of code written \(−0 removed\) in 1 commits/)
    assert.match(html, /<svg class="chart"/)
    assert.doesNotMatch(html, /<script|https?:\/\/(?!www\.w3\.org)/)
    assert.match(markdown, /\| shadow_app_x \| 1 \|/)
    assert.match(markdown, /Other contributors in these repositories: 1 counted commits/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
