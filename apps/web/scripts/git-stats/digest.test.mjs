import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localDayOf, planDays } from './digest-days.mjs'
import { AeonPoster, loadEnvFile } from './digest-post.mjs'
import { aiAttribution, buildPayload, buildRepoDay } from './digest-stats.mjs'
import { DigestStore } from './digest-store.mjs'
import { DigestRunner, parseDigestCli } from './digest.mjs'

const TZ = 'Europe/London'
const NOW = () => new Date('2026-10-08T10:00:00Z')
const OWNER = ['Owner', 'owner@example.com']
const AGENT = ['Copilot', '198982749+Copilot@users.noreply.github.com']
const lines = (n, p = 'x') => Array.from({ length: n }, (_, i) => `${p} ${i}`).join('\n') + '\n'

function git(cwd, args, { date, author = OWNER } = {}) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: author[0], GIT_AUTHOR_EMAIL: author[1], GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'owner@example.com' }
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  const res = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
  return res.stdout.trim()
}

function commit(repo, file, content, message, date, author) {
  const full = join(repo, ...file.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', message], { date, author })
  return git(repo, ['rev-parse', 'HEAD']).slice(0, 7)
}

function buildFixture(root) {
  const repo = join(root, 'fixture_repo')
  mkdirSync(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  const s = {}
  s.pre = commit(repo, 'README.md', 'hi\n', 'pre-window', '2026-09-20T12:00:00+01:00')
  s.f = commit(repo, 'src/f.ts', lines(3), 'late on the 5th', '2026-10-05T23:59:00+01:00')
  s.a = commit(repo, 'src/a.ts', lines(10), 'feat: a', '2026-10-06T09:00:00+01:00')
  s.b = commit(repo, 'src/b.ts', lines(4), 'stranger work', '2026-10-06T10:00:00+01:00', ['Stranger', 'who@else.org'])
  s.e = commit(repo, 'data/rows.csv', lines(20001), 'chore: data dump\n\nCo-authored-by: Claude <noreply@anthropic.com>', '2026-10-06T12:00:00+01:00')
    s.g = commit(repo, 'src/huge.ts', lines(40001), 'feat: vendored engine', '2026-10-06T13:00:00+01:00')
  s.c = commit(repo, 'src/c.ts', lines(2), 'agent in California', '2026-10-06T22:30:00-07:00', AGENT)
  s.d = commit(repo, 'src/d.ts', lines(5), 'utc midnight-ish', '2026-10-06T23:30:00+00:00')
  return { repo, s }
}

function fixtureConfig(root, extra = {}) {
  return {
    root, repos: ['fixture_repo'], exclude_paths: [], repo_overrides: {},
    identities: { owner_human: ['owner@example.com'], owner_agent: [AGENT[1]], others: ['who@else.org'] },
    ...extra,
  }
}

function mockFetch(handler = () => ({ status: 201, body: { data: { id: 'mem-1' } } })) {
  const calls = []
  const fn = async (url, init) => {
    const payload = JSON.parse(init.body)
    calls.push({ url, payload, auth: init.headers.authorization })
    const { status, body, headers = {} } = handler(payload, calls.length)
    return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body ?? {}) }
  }
  return { fn, calls }
}

function runner(root, store, fetchImpl, extra = {}) {
  const poster = new AeonPoster({ baseUrl: 'http://aeon.test/', apiKey: 'test-key', fetchImpl, sleep: async () => {}, minIntervalMs: 0 })
  return new DigestRunner({ config: fixtureConfig(root), store, poster, now: NOW, timeZone: TZ, lookbackDays: 30, concurrency: 1, print: () => {}, ...extra })
}

test('localDayOf buckets instants by the requested zone', () => {
  assert.equal(localDayOf('2026-10-06T22:30:00-07:00', TZ), '2026-10-07')
  assert.equal(localDayOf('2026-10-06T23:30:00+00:00', TZ), '2026-10-07')
  assert.equal(localDayOf('2026-10-05T23:59:00+01:00', TZ), '2026-10-05')
  assert.equal(localDayOf('2026-01-15T23:30:00+00:00', TZ), '2026-01-15')
  assert.equal(localDayOf('garbage', TZ), null)
})

test('planDays: first run takes yesterday, catch-up after downtime, retries incomplete days, never today', () => {
  const today = '2026-10-08'
  assert.deepEqual(planDays({ today, receipts: { days: {} } }), ['2026-10-07'])
  assert.deepEqual(planDays({ today, receipts: { days: {} }, catchUp: 3, explicitCatchUp: true }), ['2026-10-05', '2026-10-06', '2026-10-07'])
  const off = { days: { '2026-10-01': { complete: true }, '2026-10-02': { complete: true }, '2026-10-03': { complete: false } } }
  assert.deepEqual(planDays({ today, receipts: off }), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])
  const old = { days: { '2026-09-01': { complete: true } } }
  assert.equal(planDays({ today, receipts: old }).length, 7, 'capped at 7 days back')
  assert.equal(planDays({ today, receipts: old })[0], '2026-10-01')
  const done = { days: Object.fromEntries(['2026-10-06', '2026-10-07'].map((d) => [d, { complete: true }])) }
  assert.deepEqual(planDays({ today, receipts: done }), [])
  assert.deepEqual(planDays({ today, receipts: done, day: '2026-10-06' }), ['2026-10-06'])
  assert.throws(() => planDays({ today, receipts: done, day: today }), /not a completed local day/)
  assert.throws(() => planDays({ today, receipts: done, day: '2026/10/06' }))
})

test('cli parsing', () => {
  const o = parseDigestCli(['--dry-run', '--day', '2026-10-06', '--repos', 'a, b'])
  assert.deepEqual([o.dryRun, o.writeStore, o.day, o.repos, o.explicitCatchUp, o.catchUp], [true, false, '2026-10-06', ['a', 'b'], false, 7])
  assert.equal(parseDigestCli(['--dry-run', '--store']).writeStore, true)
  assert.equal(parseDigestCli(['--catch-up', '3']).explicitCatchUp, true)
  assert.throws(() => parseDigestCli(['--catch-up', '0']))
})

test('payload shape: exact keys, externalId, no top-level repo key, summary cap', () => {
  const commits = Array.from({ length: 20 }, (_, i) => ({
    sha: `${i}`.padStart(40, 'a'), subject: `s${i}`, aiAssisted: i === 0, counted: true, identityClass: 'owner_human',
    authorDate: '2026-10-06T12:00:00+01:00', linesAdded: 2, linesRemoved: 1, filesAdded: 1, filesModified: 0, filesDeleted: 0,
    buckets: { code: { added: 2, removed: 1 } }, codeDirs: { src: 3 }, giant: false, noise: null,
  }))
  const rd = buildRepoDay('shadow_app_x', '2026-10-06', commits, { prs: [{ status: 'completed', createdAt: '2026-10-06T08:00:00Z', closedAt: '2026-10-06T09:00:00Z' }], timeZone: TZ })
  const p = buildPayload(rd)
  assert.deepEqual(Object.keys(p), ['title', 'type', 'source', 'summary', 'bodyMd', 'tags', 'sourceMetadata'])
  assert.equal(p.title, 'shadow_app_x · git · 2026-10-06')
  assert.deepEqual([p.type, p.source], ['observation', 'cron'])
  assert.deepEqual(p.tags, ['git-digest', 'repo:shadow_app_x'])
  assert.equal(p.summary, '20 commits, +40/−20 lines (code +40), 1 PR merged')
  assert.ok(p.summary.length <= 240)
  const m = p.sourceMetadata
  assert.equal('repo' in m, false)
  assert.deepEqual(Object.keys(m), ['kind', 'externalId', 'repoSlug', 'day', 'stats', 'commits'])
  assert.equal(m.externalId, 'git-digest:shadow_app_x:2026-10-06')
  assert.deepEqual(Object.keys(m.stats), ['commits', 'linesAdded', 'linesRemoved', 'honestAdded', 'honestRemoved', 'codeAdded', 'codeRemoved', 'filesAdded', 'filesModified', 'filesDeleted', 'aiAssistedCommits',   'giantCommits', 'prsOpened', 'prsMerged', 'rawAdded', 'rawRemoved', 'aiCommits', 'aiCodeAdded'])
  assert.deepEqual([m.stats.prsOpened, m.stats.prsMerged], [1, 1])
    assert.deepEqual([m.stats.aiCommits, m.stats.aiCodeAdded], [1, 2])
    assert.equal(m.commits.length, 15)
    assert.deepEqual(m.commits[0], { sha: 'aaaaaaa', subject: 's0', aiAssisted: true, aiAttributed: true, aiReason: 'trailer' })
  assert.match(p.bodyMd, /- `aaaaaaa` s0 \(AI-assisted\)/)
  assert.match(p.bodyMd, /…and 5 more/)
  assert.equal(buildPayload(buildRepoDay('r', '2026-10-06', commits, { timeZone: TZ })).sourceMetadata.stats.prsMerged, null)
})

test('AI attribution: extractor field wins, else agent identity, trailer, or owner commit in the agent era', () => {
  const base = { counted: true, authorDate: '2026-10-06T12:00:00+01:00', linesAdded: 5, linesRemoved: 0, filesAdded: 0, filesModified: 1, filesDeleted: 0, buckets: { code: { added: 5, removed: 0 } }, codeDirs: {}, giant: false, noise: null }
  const human = { ...base, sha: 'h'.repeat(40), identityClass: 'owner_human', aiAssisted: false }
  assert.deepEqual(aiAttribution(human, { agentEraStart: null }), { ai: false, reason: null })
  assert.deepEqual(aiAttribution(human, { agentEraStart: '2026-10-07' }), { ai: false, reason: null })
  assert.deepEqual(aiAttribution(human, { agentEraStart: '2026-10-06' }), { ai: true, reason: 'agent_era' })
  assert.deepEqual(aiAttribution({ ...human, identityClass: 'owner_agent' }), { ai: true, reason: 'agent_identity' })
  assert.deepEqual(aiAttribution({ ...human, aiAssisted: true }), { ai: true, reason: 'trailer' })
  assert.deepEqual(aiAttribution({ ...human, aiAttributed: false, aiReason: null }, { agentEraStart: '2026-01-01' }), { ai: false, reason: null })
  assert.deepEqual(aiAttribution({ ...human, aiAttributed: true, aiReason: 'agent_era' }), { ai: true, reason: 'agent_era' })
  const big = { ...human, sha: 'b'.repeat(40), giant: true, giantReason: 'authored +50000 > 40000', linesAdded: 50000, buckets: { code: { added: 50000, removed: 0 } } }
  const rd = buildRepoDay('r', '2026-10-06', [human, big], { timeZone: TZ, agentEraStart: '2026-08-20' })
  assert.deepEqual([rd.stats.aiCommits, rd.stats.aiCodeAdded, rd.stats.codeAdded, rd.stats.honestAdded], [2, 50005, 50005, 50005])
  assert.equal(rd.bigDrops.length, 1)
})

test('fixture repo: local-day bucketing, owner filter, big drops counted, receipts stop re-posts', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'git-digest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { s } = buildFixture(root)
  const store = new DigestStore(join(root, 'home'))
  const { fn, calls } = mockFetch((p, n) => ({ status: 201, body: { data: { id: `mem-${n}` } } }))
  const report = await runner(root, store, fn).run({ catchUp: 3, explicitCatchUp: true })
  assert.deepEqual(report.days, ['2026-10-05', '2026-10-06', '2026-10-07'])
  assert.equal(report.failures, 0)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].url, 'http://aeon.test/api/v1/memories')
  assert.equal(calls[0].auth, 'Bearer test-key')
  const byDay = Object.fromEntries(calls.map((c) => [c.payload.sourceMetadata.day, c.payload.sourceMetadata]))
  assert.deepEqual(byDay['2026-10-05'].commits.map((c) => c.sha), [s.f])
  const d6 = byDay['2026-10-06']
  assert.deepEqual(d6.commits.map((c) => c.sha), [s.a, s.e, s.g], 'stranger excluded; late-evening commits moved to the 7th')
  assert.deepEqual([d6.stats.linesAdded, d6.stats.rawAdded], [10 + 40001, 10 + 20001 + 40001], 'CSV dump is data: raw only, 0 authored')
  assert.deepEqual([d6.stats.honestAdded, d6.stats.codeAdded, d6.stats.giantCommits, d6.stats.aiAssistedCommits], [40011, 40011, 1, 1], 'giant commit still counts in full')
  assert.deepEqual([d6.stats.aiCommits, d6.stats.aiCodeAdded], [1, 0], 'trailer-only AI commit touched data, not code')
  assert.equal(d6.stats.prsMerged, null)
  assert.equal(calls.find((c) => c.payload.sourceMetadata.day === '2026-10-06').payload.summary, '3 commits, +40011/−0 lines (code +40011), PRs n/a')
  assert.deepEqual(byDay['2026-10-07'].commits.map((c) => c.sha), [s.d, s.c], 'owner_agent kept, bucketed by London day')
  assert.deepEqual([byDay['2026-10-07'].stats.aiCommits, byDay['2026-10-07'].stats.aiCodeAdded], [1, 2], 'agent identity counts as AI; era off without agent_era_start')
  assert.deepEqual(byDay['2026-10-07'].commits.map((c) => c.aiReason), [null, 'agent_identity'])
  const body6 = calls.find((c) => c.payload.sourceMetadata.day === '2026-10-06').payload.bodyMd
  assert.match(body6, /\*\*3 commits \(1 by AI\)\*\* · code \+40,011\/−0 · authored \+40,011\/−0 \(raw \+60,012\/−0\)/)
  assert.match(body6, new RegExp(`Big drops \\(included above\\):\\*\\* \`${s.g}\` feat: vendored engine \\(\\+40,001 authored, authored \\+40001 > 40000\\)`))
  assert.doesNotMatch(body6, /Big drops.*data dump/)
  assert.doesNotMatch(body6, /excluded|counted/)

  const receipts = store.readReceipts()
  assert.ok(Object.values(receipts.days).every((d) => d.complete))
  assert.equal(receipts.days['2026-10-06'].repos.fixture_repo.memoryId, 'mem-2')
  const history = readFileSync(store.historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(history.length, 3)
  const daily = JSON.parse(readFileSync(join(store.home, 'daily', '2026-10-06.json'), 'utf8'))
  assert.equal(daily.repos.fixture_repo.stats.commits, 3)
  assert.equal(daily.totals.activeRepos, 1)

  const again = await runner(root, store, fn).run({})
  assert.deepEqual(again.days, [], 'nothing left in the catch-up window')
  const forced = await runner(root, store, fn).run({ day: '2026-10-06' })
  assert.equal(forced.perDay['2026-10-06'].skipped, 1)
  assert.equal(calls.length, 3, 'receipted repo-days are never re-posted')
  assert.equal(readFileSync(store.historyPath, 'utf8').trim().split('\n').length, 3, 'history stays one row per repo-day')
})

test('failed posts stay un-receipted and are retried next run; dry run writes nothing', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'git-digest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  buildFixture(root)
  const store = new DigestStore(join(root, 'home'))
  const printed = []
  const dry = await runner(root, store, null, { poster: null, print: (x) => printed.push(x) }).run({ day: '2026-10-06', dryRun: true, writeStore: false })
  assert.equal(dry.perDay['2026-10-06'].active, 1)
  assert.equal(JSON.parse(printed[0]).sourceMetadata.externalId, 'git-digest:fixture_repo:2026-10-06')
  assert.equal(existsSync(store.home), false)

  const bad = mockFetch((p) => (p.sourceMetadata.day === '2026-10-06' ? { status: 503, body: { error: 'down' } } : { status: 201, body: { data: { id: 'ok' } } }))
  const first = await runner(root, store, bad.fn).run({ catchUp: 3, explicitCatchUp: true })
  assert.equal(first.failures, 1)
  assert.equal(bad.calls.filter((c) => c.payload.sourceMetadata.day === '2026-10-06').length, 3, 'max 3 tries')
  const r = store.readReceipts().days
  assert.equal(r['2026-10-06'], undefined)
  assert.equal(r['2026-10-07'].complete, true)

  const good = mockFetch()
  const second = await runner(root, store, good.fn).run({})
  assert.deepEqual(second.days, ['2026-10-06'])
  assert.equal(good.calls.length, 1)
  assert.equal(store.readReceipts().days['2026-10-06'].complete, true)
})

test('agent_era_start from repos.json reaches the extractor: owner commits from that day are AI', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'git-digest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { s } = buildFixture(root)
  const store = new DigestStore(join(root, 'home'))
  const printed = []
  const era = runner(root, store, null, { poster: null, config: fixtureConfig(root, { agent_era_start: '2026-10-06' }), print: (x) => printed.push(JSON.parse(x)) })
  await era.run({ catchUp: 3, explicitCatchUp: true, dryRun: true, writeStore: false })
  const byDay = Object.fromEntries(printed.map((p) => [p.sourceMetadata.day, p.sourceMetadata]))
  assert.deepEqual(byDay['2026-10-06'].commits.map((c) => [c.sha, c.aiReason]), [[s.a, 'agent_era'], [s.e, 'trailer'], [s.g, 'agent_era']])
  assert.deepEqual([byDay['2026-10-06'].stats.aiCommits, byDay['2026-10-06'].stats.aiCodeAdded], [3, 40011])
  assert.deepEqual(byDay['2026-10-05'].commits.map((c) => [c.sha, c.aiReason]), [[s.f, null]], 'before the era owner commits are human')
  assert.equal(byDay['2026-10-05'].stats.aiCommits, 0)
})

test('no-activity day posts nothing but is receipted', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'git-digest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  buildFixture(root)
  const store = new DigestStore(join(root, 'home'))
  const { fn, calls } = mockFetch()
  const quiet = runner(root, store, fn, { now: () => new Date('2026-10-02T10:00:00Z') })
  const report = await quiet.run({})
  assert.deepEqual(report.days, ['2026-10-01'])
  assert.equal(calls.length, 0)
  assert.equal(store.readReceipts().days['2026-10-01'].complete, true)
})

test('poster paces writes to the rate limit and retries 429 / 5xx only', async () => {
  let clock = 0
  const sleeps = []
  const sleep = async (ms) => { sleeps.push(ms); clock += ms }
  const responses = [{ status: 201 }, { status: 429, headers: { 'retry-after': '2' } }, { status: 201 }, { status: 400 }, { status: 201 }]
  const fetchImpl = async () => {
    clock += 100
    const r = responses.shift()
    return { ok: r.status < 300, status: r.status, headers: { get: (k) => r.headers?.[k] ?? null }, text: async () => '{"data":{"id":"m"}}' }
  }
  const poster = new AeonPoster({ baseUrl: 'http://x', apiKey: 'k', fetchImpl, sleep, now: () => clock, minIntervalMs: 1100 })
  const payload = { sourceMetadata: { externalId: 'e' } }
  assert.equal((await poster.post(payload)).ok, true)
  assert.equal((await poster.post(payload)).ok, true, '429 retried after Retry-After')
  const rejected = await poster.post(payload)
  assert.deepEqual([rejected.ok, rejected.status], [false, 400])
  assert.equal(poster.writes, 4, '400 is not retried')
  assert.deepEqual(sleeps, [1000, 2000, 1000])
  const writeTimes = []
  const timed = new AeonPoster({ baseUrl: 'http://x', apiKey: 'k', fetchImpl: async () => { writeTimes.push(clock); return { ok: true, status: 201, headers: { get: () => null }, text: async () => '{}' } }, sleep, now: () => clock })
  for (let i = 0; i < 5; i++) await timed.post(payload)
  for (let i = 1; i < writeTimes.length; i++) assert.ok(writeTimes[i] - writeTimes[i - 1] >= 1000, 'at most 60 writes per minute')
  assert.throws(() => new AeonPoster({ baseUrl: 'http://x', apiKey: '' }), /AEON_API_KEY/)
})

test('env file fills unset keys only', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'git-digest-env-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, '.env.local')
  writeFileSync(path, '# c\nAEON_BASE_URL="http://h"\r\nAEON_API_KEY=abc\n')
  const env = { AEON_API_KEY: 'kept' }
  assert.equal(loadEnvFile(path, env), true)
  assert.deepEqual(env, { AEON_API_KEY: 'kept', AEON_BASE_URL: 'http://h' })
  assert.equal(loadEnvFile(join(dir, 'missing'), env), false)
})
