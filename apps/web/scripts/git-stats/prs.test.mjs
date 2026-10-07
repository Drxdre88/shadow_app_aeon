import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  TITLE_MAX, adoPullsUrl, clip, isSince, mapLimit, normaliseAdoPr, normaliseGhPr, parseArgs,
  parseJsonLines, parseRemote, summariseRepo, summaryMarkdown, writeOutputs, errorText,
} from './prs.mjs'

const ADO_PR = {
  pullRequestId: 61408,
  title: 'Relic 0.3.0\n  release',
  status: 'completed',
  createdBy: { displayName: 'Andrey Selikhov', uniqueName: 'andrey@sefe.eu' },
  creationDate: '2026-10-01T09:00:00.123Z',
  closedDate: '2026-10-01T10:00:00Z',
  sourceRefName: 'refs/heads/feat/relic-0.3.0',
  targetRefName: 'refs/heads/main',
  mergeStatus: 'succeeded',
  isDraft: false,
  completionOptions: { mergeStrategy: 'noFastForward' },
  lastMergeCommit: { commitId: 'abc123' },
}

const GH_PR = {
  number: 42,
  title: 'feat: board',
  state: 'closed',
  merged_at: '2026-01-02T00:00:00Z',
  closed_at: '2026-01-02T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  user: { login: 'Drxdre88' },
  head: { ref: 'feat/board' },
  base: { ref: 'main' },
  draft: false,
  merge_commit_sha: 'def456',
}

test('parseRemote classifies ADO, GitHub, unknown and missing origins', () => {
  assert.deepEqual(parseRemote('https://sefe@dev.azure.com/sefe/Short%20Term%20Power/_git/stp_app_relic'),
    { kind: 'ado', org: 'sefe', project: 'Short%20Term%20Power', repo: 'stp_app_relic' })
  assert.deepEqual(parseRemote('https://dev.azure.com/sefe/ETP/_git/kal_el_dash\n'),
    { kind: 'ado', org: 'sefe', project: 'ETP', repo: 'kal_el_dash' })
  assert.deepEqual(parseRemote('https://github.com/Drxdre88/shadow_app_aeon.git'),
    { kind: 'github', owner: 'Drxdre88', repo: 'shadow_app_aeon' })
  assert.deepEqual(parseRemote('git@github.com:Drxdre88/shadow_lab.git'),
    { kind: 'github', owner: 'Drxdre88', repo: 'shadow_lab' })
  assert.deepEqual(parseRemote(''), { kind: 'none' })
  assert.deepEqual(parseRemote(undefined), { kind: 'none' })
  const unknown = parseRemote('https://user:secret@gitlab.com/x/y.git')
  assert.equal(unknown.kind, 'unknown')
  assert.ok(!unknown.url.includes('secret'), 'userinfo stripped from recorded url')
})

test('clip flattens whitespace and never exceeds the cap', () => {
  assert.equal(clip('a\n  b'), 'a b')
  const long = clip('x'.repeat(300))
  assert.equal(long.length, TITLE_MAX)
  assert.ok(long.endsWith('…'))
  assert.equal(clip(null), null)
})

test('isSince is inclusive of the since day and rejects junk', () => {
  assert.equal(isSince('2025-10-07T00:00:00Z', '2025-10-07'), true)
  assert.equal(isSince('2025-10-06T23:59:59Z', '2025-10-07'), false)
  assert.equal(isSince(undefined, '2025-10-07'), false)
  assert.equal(isSince('not a date', '2025-10-07'), false)
})

test('normaliseAdoPr maps the ADO item to the shared shape', () => {
  const pr = normaliseAdoPr(ADO_PR, 'stp_app_relic')
  assert.equal(pr.id, 61408)
  assert.equal(pr.title, 'Relic 0.3.0 release')
  assert.equal(pr.status, 'completed')
  assert.deepEqual(pr.author, { displayName: 'Andrey Selikhov', login: 'andrey@sefe.eu' })
  assert.equal(pr.sourceRef, 'feat/relic-0.3.0')
  assert.equal(pr.targetRef, 'main')
  assert.equal(pr.mergeStrategy, 'noFastForward')
  assert.equal(pr.mergeCommit, 'abc123')
  assert.equal(pr.commitCount, null)
})

test('normaliseAdoPr tolerates an active PR with missing optional fields', () => {
  const pr = normaliseAdoPr({ pullRequestId: 1, status: 'active', creationDate: '2026-01-01T00:00:00Z' }, 'r')
  assert.equal(pr.closedAt, null)
  assert.equal(pr.mergeStrategy, null)
  assert.equal(pr.mergeCommit, null)
  assert.equal(pr.isDraft, false)
  assert.deepEqual(pr.author, { displayName: null, login: null })
})

test('normaliseGhPr derives completed / abandoned / active from state + merged_at', () => {
  assert.equal(normaliseGhPr(GH_PR, 'r').status, 'completed')
  assert.equal(normaliseGhPr({ ...GH_PR, merged_at: null }, 'r').status, 'abandoned')
  assert.equal(normaliseGhPr({ ...GH_PR, state: 'open', merged_at: null }, 'r').status, 'active')
})

test('normaliseGhPr takes size stats only from the per-PR detail', () => {
  const bare = normaliseGhPr(GH_PR, 'r')
  assert.equal(bare.additions, null)
  const rich = normaliseGhPr(GH_PR, 'r', { additions: 10, deletions: 2, changed_files: 3, commits: 4, mergeable_state: 'clean' })
  assert.deepEqual([rich.additions, rich.deletions, rich.changedFiles, rich.commitCount], [10, 2, 3, 4])
  assert.equal(rich.author.login, 'Drxdre88')
  assert.equal(rich.sourceRef, 'feat/board')
})

test('parseJsonLines reads gh --jq ".[]" output and skips blank lines', () => {
  const out = parseJsonLines('{"number":1}\r\n\n{"number":2}\n')
  assert.deepEqual(out.map((p) => p.number), [1, 2])
  assert.deepEqual(parseJsonLines(''), [])
})

test('adoPullsUrl is a status=all paged GET with the since filter', () => {
  const url = new URL(adoPullsUrl({ org: 'sefe', project: 'Short%20Term%20Power', repo: 'meteo_lab' }, 200, '2025-10-07'))
  assert.equal(url.pathname, '/sefe/Short%20Term%20Power/_apis/git/repositories/meteo_lab/pullrequests')
  assert.equal(url.searchParams.get('searchCriteria.status'), 'all')
  assert.equal(url.searchParams.get('$skip'), '200')
  assert.equal(url.searchParams.get('$top'), '100')
  assert.equal(url.searchParams.get('searchCriteria.minTime'), '2025-10-07T00:00:00Z')
  assert.equal(url.searchParams.get('api-version'), '7.1')
})

test('summariseRepo counts status, author and month', () => {
  const records = [
    normaliseAdoPr(ADO_PR, 'r'),
    normaliseAdoPr({ ...ADO_PR, status: 'abandoned', creationDate: '2026-09-30T00:00:00Z' }, 'r'),
    normaliseGhPr({ ...GH_PR, state: 'open', merged_at: null }, 'r'),
  ]
  const s = summariseRepo(records)
  assert.deepEqual([s.created, s.completed, s.abandoned, s.active], [3, 1, 1, 1])
  assert.deepEqual(s.byAuthor, { 'andrey@sefe.eu': 2, Drxdre88: 1 })
  assert.deepEqual(s.byMonth, { '2026-10': 1, '2026-09': 1, '2026-01': 1 })
})

test('summaryMarkdown shows counts or the failure reason per repo', () => {
  const md = summaryMarkdown([
    { repo: 'a', host: 'ado', summary: summariseRepo([normaliseAdoPr(ADO_PR, 'a')]) },
    { repo: 'b', host: 'none', summary: null, error: 'no origin remote' },
  ], '2025-10-07')
  assert.match(md, /\| a \| ado \| 1 \| 1 \| 0 \| 0 \|/)
  assert.match(md, /\| b \| none \|.*no origin remote \|/)
})

test('mapLimit preserves order and caps concurrency', async () => {
  let inFlight = 0
  let peak = 0
  const out = await mapLimit([5, 1, 3, 2, 4, 0], 2, async (n) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setImmediate(r))
    inFlight -= 1
    return n * 2
  })
  assert.deepEqual(out, [10, 2, 6, 4, 8, 0])
  assert.ok(peak <= 2)
})

test('parseArgs validates since/out and splits --repos', () => {
  const a = parseArgs(['--since', '2025-10-07', '--out', 'x', '--repos', 'a, b'])
  assert.deepEqual(a.repos, ['a', 'b'])
  assert.throws(() => parseArgs(['--since', '07/10/2025', '--out', 'x']), /YYYY-MM-DD/)
  assert.throws(() => parseArgs(['--since', '2025-10-07']), /--out/)
  assert.equal(parseArgs(['--out', 'x']).repos.length, 31)
})

test('errorText prefers gh stderr over the command line', () => {
  assert.equal(errorText({ message: 'Command failed: gh api x', stderr: 'gh: Not Found (HTTP 404)\n' }), 'gh: Not Found (HTTP 404)')
  assert.equal(errorText(new Error('boom\nstack')), 'boom')
})

test('writeOutputs writes per-repo json, prs.jsonl and summaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prs-test-'))
  try {
    const records = [normaliseAdoPr(ADO_PR, 'a')]
    writeOutputs(dir, [
      { repo: 'a', host: 'ado', records, summary: summariseRepo(records) },
      { repo: 'b', host: 'none', records: [], error: 'no origin remote', summary: null },
    ], '2025-10-07')
    const lines = readFileSync(join(dir, 'prs.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 1)
    const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))
    assert.equal(summary.totals.created, 1)
    assert.equal(summary.repos.find((r) => r.repo === 'b').error, 'no origin remote')
    assert.equal(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).records.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
