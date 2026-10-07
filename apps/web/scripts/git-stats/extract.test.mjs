import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathClassifier, globToRegExp } from './classify.mjs'
import { parseLogTokens } from './log-parse.mjs'
import { IdentityMatcher, isoWeek } from './summary.mjs'
import { markCrossRepo, parseCli, runExtraction } from './extract.mjs'

const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n'

function git(cwd, args, { date, authorDate, author = ['Owner', 'owner@example.com'] } = {}) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_COMMITTER_NAME: 'Owner', GIT_COMMITTER_EMAIL: 'owner@example.com' }
  if (date) {
    env.GIT_COMMITTER_DATE = date
    env.GIT_AUTHOR_DATE = authorDate || date
  }
  env.GIT_AUTHOR_NAME = author[0]
  env.GIT_AUTHOR_EMAIL = author[1]
  const res = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`)
  return res.stdout.trim()
}

function write(repo, rel, content) {
  const full = join(repo, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

function commitAll(repo, message, day, opts = {}) {
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', message], { date: `2025-11-${day}T12:00:00+01:00`, ...opts })
  return git(repo, ['rev-parse', 'HEAD'])
}

function buildFixture(root) {
  const repo = join(root, 'fixture')
  mkdirSync(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  const shas = {}
  write(repo, '.gitignore', 'node_modules\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'pre-window'], { date: '2025-09-01T12:00:00+01:00' })
  write(repo, 'src/app.ts', lines(10, 'const a'))
  write(repo, 'README.md', lines(3, '# doc'))
  write(repo, 'package-lock.json', lines(50, '"x": 1,'))
  write(repo, 'img.png', Buffer.from([0, 1, 2, 0, 255, 0, 7]))
  write(repo, 'tests/app.test.ts', lines(4, 'it()'))
  write(repo, 'ü dir/naïve.py', lines(2, 'x ='))
  write(repo, 'config.json', lines(5, '"k": 1,'))
  write(repo, 'vendorized/x.py', lines(7, 'v ='))
  write(repo, 'tests/notes.md', lines(2, '# note'))
  write(repo, 'app/templates/page.html', lines(3, '<p>'))
  write(repo, 'docs/report.html', lines(4, '<td>'))
  write(repo, 'data/small.json', lines(3, '"d": 1,'))
  shas.c1 = commitAll(repo, 'initial import', '01')
  mkdirSync(join(repo, 'src', 'core'))
  git(repo, ['mv', 'src/app.ts', 'src/core/app.ts'])
  write(repo, 'src/core/app.ts', lines(9, 'const a') + 'const a changed\n')
  shas.c2 = commitAll(repo, 'move app', '02')
  git(repo, ['checkout', '-q', '-b', 'feature'])
  write(repo, 'src/feature.ts', lines(5, 'feat'))
  shas.c3 = commitAll(repo, 'add feature', '03')
  git(repo, ['checkout', '-q', 'main'])
  write(repo, 'README.md', lines(4, '# doc'))
  shas.c4 = commitAll(repo, 'docs\n\nCo-authored-by: Claude <noreply@anthropic.com>', '04')
  git(repo, ['cherry-pick', shas.c3], { date: '2025-11-05T12:00:00+01:00', authorDate: '2025-11-03T12:00:00+01:00' })
  shas.c5 = git(repo, ['rev-parse', 'HEAD'])
  git(repo, ['checkout', '-q', 'feature'])
  write(repo, 'src/feature2.ts', lines(3, 'feat2'))
  shas.c6 = commitAll(repo, 'feature two', '06', { author: ['dependabot[bot]', 'dep@users.noreply.github.com'] })
  git(repo, ['checkout', '-q', 'main'])
  git(repo, ['merge', '-q', '--no-ff', 'feature', '-m', 'merge feature'], { date: '2025-11-07T12:00:00+01:00' })
  shas.m1 = git(repo, ['rev-parse', 'HEAD'])
  write(repo, 'data/big.json', lines(2500, '"v": 1,'))
  write(repo, 'data/rows.csv', lines(20001, 'r'))
  write(repo, 'src/huge.py', lines(40001, 'h ='))
  shas.c7 = commitAll(repo, 'data dump', '08', { author: ['Stranger', 'who@else.org'] })
  git(repo, ['checkout', '-q', '-b', 'sq'])
  write(repo, 'lib/a.py', lines(3, 'a ='))
  shas.s1 = commitAll(repo, 'sq one', '09')
  write(repo, 'lib/a.py', lines(5, 'a ='))
  shas.s2 = commitAll(repo, 'sq two', '10')
  git(repo, ['checkout', '-q', 'main'])
  git(repo, ['merge', '-q', '--squash', 'sq'])
  shas.sq = commitAll(repo, 'Merged PR 1: squash', '11')
  git(repo, ['checkout', '-q', '-b', 'gh'])
  write(repo, 'lib/gh.py', lines(6, 'g ='))
  commitAll(repo, 'gh work', '12')
  git(repo, ['checkout', '-q', 'main'])
  git(repo, ['merge', '-q', '--squash', 'gh'])
  shas.gh = commitAll(repo, 'feat: gh thing (#7)', '13')
  git(repo, ['branch', '-q', '-D', 'gh'])
  git(repo, ['checkout', '-q', '-b', 'kept'])
  write(repo, 'lib/k.py', lines(2, 'k ='))
  shas.k1 = commitAll(repo, 'k one', '14')
  write(repo, 'lib/k.py', lines(4, 'k ='))
  shas.k2 = commitAll(repo, 'k two', '15')
  git(repo, ['checkout', '-q', 'main'])
  git(repo, ['merge', '-q', '--squash', 'kept'])
  shas.kept = commitAll(repo, 'Merged PR 8: kept', '16')
  git(repo, ['checkout', '-q', 'kept'])
  write(repo, 'lib/k.py', lines(5, 'k ='))
  shas.k3 = commitAll(repo, 'k three', '17')
  git(repo, ['checkout', '-q', 'main'])
  return { repo, shas }
}

test('classifier buckets paths honestly', () => {
  const c = new PathClassifier({ excludeGlobs: ['**/assets/public/**'] })
  assert.equal(c.classify('apps/web/src/a.tsx'), 'code')
  assert.equal(c.classify('apps/web/src/__tests__/a.ts'), 'tests')
  assert.equal(c.classify('pkg/test_x.py'), 'tests')
  assert.equal(c.classify('docs/guide.md'), 'docs')
  assert.equal(c.classify('requirements.txt'), 'config')
  assert.equal(c.classify('tsconfig.json', 30), 'config')
  assert.equal(c.classify('fixtures/dump.json', 2001), 'generated_or_data')
  assert.equal(c.classify('package-lock.json'), 'generated_or_data')
  assert.equal(c.classify('uv.lock'), 'generated_or_data')
  assert.equal(c.classify('web/node_modules/x/index.js'), 'generated_or_data')
  assert.equal(c.classify('nb/analysis.ipynb'), 'generated_or_data')
  assert.equal(c.classify('drizzle/meta/0001_snapshot.json', 10), 'generated_or_data')
  assert.equal(c.classify('android/app/src/main/assets/public/main.js'), 'generated_or_data')
  assert.equal(c.classify('arc.js'), 'code')
  assert.equal(c.classify('rift/app/templates/index.html', 3000), 'code')
  assert.equal(c.classify('apps/etp-rift/src/static/page.htm'), 'code')
  assert.equal(c.classify('docs/report.html', 10), 'generated_or_data')
  assert.equal(c.classify('project/runs/r1/metrics.json', 10), 'generated_or_data')
  assert.equal(c.classify('research/notes.json', 5), 'generated_or_data')
  assert.equal(c.classify('docs/guide.html'), 'generated_or_data')
  assert.equal(c.classify('tests/README.md'), 'docs')
  assert.equal(c.classify('pkg/tests/plan.md'), 'docs')
  assert.equal(c.classify('page.html'), 'docs')
  assert.equal(c.isExcluded('android/app/src/main/assets/public/main.js'), true)
  assert.equal(c.isExcluded('src/main.js'), false)
  assert.equal(c.classify('LICENSE'), 'docs')
  assert.equal(c.classify('weird.xyz'), 'other')
  assert.equal(c.dirKey('apps/web/src/a.ts'), 'apps/web')
  assert.equal(c.dirKey('root.ts'), '.')
  assert.ok(globToRegExp('**/x/**').test('x/y.ts'))
})

test('identity matcher applies class precedence and globs', () => {
  const m = new IdentityMatcher({ owner_human: ['Owner'], bots: ['*[bot]'], owner_agent: ['*@anthropic.com'] })
  assert.equal(m.classify('dependabot[bot]', 'a@b'), 'bots')
  assert.equal(m.classify('Owner', 'noreply@anthropic.com'), 'owner_agent')
  assert.equal(m.classify('owner', 'me@x'), 'owner_human')
  assert.equal(m.classify('Someone', 's@x'), 'unknown')
})

test('isoWeek handles year boundaries', () => {
  assert.equal(isoWeek('2025-12-29'), '2026-W01')
  assert.equal(isoWeek('2026-01-01'), '2026-W01')
  assert.equal(isoWeek('2027-01-01'), '2026-W53')
  assert.equal(isoWeek('2025-10-07'), '2025-W41')
})

test('parser handles -z renames, binaries and empty commits', async () => {
  const tokens = [
    '\x1eaaa\x1fp1\x1fA\x1fa@x\x1fA\x1fa@x\x1f2025-11-01T00:00:00+00:00\x1f2025-11-01T00:00:00+00:00\x1fCopilot <1+Copilot@users.noreply.github.com>\x1dX <x@y>\x1fsubj',
    '\n:100644 100644 1111111 2222222 R090', 'old\tname.ts', 'new\tname.ts',
    ':000000 100644 0000000 3333333 A', 'b.bin',
    '1\t1\t', 'old\tname.ts', 'new\tname.ts',
    '-\t-\tb.bin',
    '\x1ebbb\x1f\x1fB\x1fb@x\x1fB\x1fb@x\x1f2025-11-02T00:00:00+00:00\x1f2025-11-02T00:00:00+00:00\x1f\x1fempty',
    '',
  ]
  async function* gen() { yield* tokens }
  const out = []
  for await (const c of parseLogTokens(gen(), new PathClassifier())) out.push(c)
  assert.equal(out.length, 2)
  assert.deepEqual([out[0].filesRenamed, out[0].filesAdded, out[0].binaryFiles, out[0].filesChanged], [1, 1, 1, 2])
  assert.equal(out[0].buckets.code.added, 1)
  assert.equal(out[0].aiAssisted, true)
  assert.deepEqual(out[1].coAuthors, [])
  assert.equal(out[1].parents, 0)
  assert.equal(out[1].filesChanged, 0)
})

test('cross-repo marking flags identical SHAs and large identical patches', () => {
  const base = { isMerge: false, dupOf: null, linesAdded: 30, linesRemoved: 0, authorDate: '2025-11-01T00:00:00Z' }
  const commits = [
    { ...base, repo: 'b', sha: 's1', patchId: 'p1', commitDate: '2025-11-02T00:00:00Z' },
    { ...base, repo: 'a', sha: 's1', patchId: 'p1', commitDate: '2025-11-02T00:00:00Z' },
    { ...base, repo: 'c', sha: 's9', patchId: 'p1', commitDate: '2025-11-03T00:00:00Z' },
  ]
  markCrossRepo(commits)
  assert.equal(commits[0].crossRepoDupOf, 'a:s1')
  assert.equal(commits[1].crossRepoDupOf, undefined)
  assert.equal(commits[2].crossRepoPatchDupOf, 'a:s1')
})

test('cli parsing validates dates', () => {
  assert.throws(() => parseCli(['--since', '2025/10/07', '--out', 'x']))
  assert.equal(parseCli(['--since', '2025-10-07', '--out', 'x', '--repos', 'a, b']).repos.length, 2)
})

test('end-to-end extraction on a fixture repo', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'git-stats-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { repo, shas } = buildFixture(root)
  git(root, ['clone', '-q', repo, 'zclone'])
  const prsDir = join(root, 'prs')
  mkdirSync(prsDir)
  writeFileSync(join(prsDir, 'fixture.json'), JSON.stringify({
    host: 'ado',
    records: [
      { id: 7, status: 'completed', sourceRef: 'gh', mergeCommit: shas.gh, mergeStrategy: 'squash', closedAt: '2025-11-13T12:00:00Z' },
      { id: 8, status: 'completed', sourceRef: 'refs/heads/kept', mergeCommit: shas.kept, mergeStrategy: 'squash', closedAt: '2025-11-16T12:00:00Z' },
    ],
  }))
  const config = join(root, 'repos.json')
  writeFileSync(config, JSON.stringify({
    root,
    repos: ['fixture', 'zclone', 'missing_repo'],
    identities: { owner_human: ['OWNER@example.com'], bots: ['*[bot]'] },
    exclude_paths: [],
    repo_overrides: { fixture: { exclude_paths: ['vendorized/**'], noise_commits: [{ subject: '^data dump', reason: 'test dump' }] } },
  }))
  const out = join(root, 'out')
  const run = await runExtraction(
    { since: '2025-10-01', until: null, repos: null, out, config, prsDir, lookbackDays: 60, dirDepth: 2, maxSquashRefs: 50 },
    () => {},
  )
  const status = Object.fromEntries(run.repos.map((r) => [r.repo, r]))
  assert.equal(status.missing_repo.status, 'error')
  assert.equal(status.fixture.status, 'ok')
  assert.deepEqual(status.fixture.defaultRefs, ['refs/heads/main'])
  assert.equal(status.zclone.defaultRefs[0], 'refs/remotes/origin/main')

  const rows = readFileSync(join(out, 'fixture.commits.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const by = Object.fromEntries(rows.map((r) => [r.sha, r]))
  assert.equal(rows.length, 16, 'pre-window and deleted-branch commits excluded, every SHA once')
  assert.equal(new Set(rows.map((r) => r.sha)).size, rows.length)

  const c1 = by[shas.c1]
  assert.deepEqual([c1.filesChanged, c1.filesAdded, c1.binaryFiles, c1.rawLinesAdded], [12, 12, 1, 93])
  assert.deepEqual([c1.authoredAdded, c1.linesAdded, c1.excludedAdded], [29, 29, 7], 'authored = raw minus generated/data and excluded paths')
  assert.deepEqual(c1.buckets.code, { added: 15, removed: 0 })
  assert.equal(c1.buckets.tests.added, 4)
  assert.equal(c1.buckets.docs.added, 5)
  assert.equal(c1.buckets.config.added, 5)
  assert.equal(c1.buckets.generated_or_data.added, 64)
  assert.equal(c1.codeDirs['ü dir'], 2)
  assert.equal(c1.codeDirs['app/templates'], 3)
  assert.equal(c1.giant, false)

  const c2 = by[shas.c2]
  assert.deepEqual([c2.filesRenamed, c2.filesAdded, c2.filesDeleted, c2.linesAdded, c2.linesRemoved], [1, 0, 0, 1, 1])

  assert.equal(by[shas.c5].dupOf, shas.c3)
  assert.equal(by[shas.c5].dupKind, 'patch')
  assert.equal(by[shas.c3].hasDefaultCopy, true)
  assert.equal(by[shas.c3].onDefaultBranch, true)
  assert.equal(by[shas.m1].isMerge, true)
  assert.equal(by[shas.m1].linesAdded, 0)

  const c7 = by[shas.c7]
  assert.equal(c7.giant, true)
  assert.match(c7.giantReason, /authored \+40001 > 40000/)
  assert.deepEqual([c7.rawLinesAdded, c7.authoredAdded], [62502, 40001])
  assert.equal(c7.buckets.generated_or_data.added, 22501)
  assert.equal(c7.identityClass, 'unknown')
  assert.equal(by[shas.c6].identityClass, 'bots')

  const sq = by[shas.sq]
  assert.equal(sq.dupKind, 'squash')
  assert.equal(sq.dupOf, shas.s2)
  assert.equal(sq.squashOf, 1)
  assert.equal(sq.dropReason, 'squash-dup')
  assert.equal(by[shas.s1].landedViaSquash, shas.sq)
  assert.equal(by[shas.s2].onDefaultBranch, false)
  assert.deepEqual([by[shas.gh].squashOf, by[shas.gh].squashBranchPresent, by[shas.gh].counted], [7, false, true])
  assert.deepEqual([by[shas.kept].squashOf, by[shas.kept].squashBranchPresent, by[shas.kept].dropReason], [8, true, 'squash-branch-present'])
  assert.equal(by[shas.k3].counted, true)
  assert.equal(by[shas.c4].aiAssisted, true)
  assert.equal(by[shas.c1].aiAssisted, false)
  assert.equal(c7.noise, 'test dump')

  const summary = JSON.parse(readFileSync(join(out, 'fixture.summary.json'), 'utf8'))
  const t0 = summary.totals
  assert.equal(t0.commits, 16)
  assert.equal(t0.uniqueCommits, 12)
  assert.equal(t0.merges, 1)
  assert.equal(t0.duplicates, 1)
  assert.equal(t0.droppedSquashes, 2)
  assert.equal(t0.countedSquashes, 1)
  assert.equal(t0.aiAssistedCommits, 1)
  assert.equal(t0.giantCommits, 1)
  assert.equal(t0.lines_raw.added - t0.lines_counted.added, 5 + 5 + 4, 'cherry-pick, sq squash and kept squash dropped')
  assert.equal(t0.lines_counted.added - t0.authoredAdded, 64 + 22501, 'generated/data and excluded paths subtracted')
  assert.equal(t0.authoredAdded - t0.lines_counted_excl_giant_noise.added, 40001)
  assert.equal(t0.excludedPathLines.added, 7)
  assert.equal(t0.buckets.code.added, 15 + 1 + 5 + 3 + 3 + 2 + 6 + 2 + 2 + 1 + 40001)
  assert.equal(t0.codeExclGiantNoise.added, 40)
  assert.equal(summary.ownerTotals.uniqueCommits, 10)
  assert.equal(summary.ownerTotals.codeExclGiantNoise.added, 37, 'bot and unknown authors left out of owner code')
  assert.equal(summary.byIdentity.bots.uniqueCommits, 1)
  assert.deepEqual(summary.unknownIdentities, [{ identity: 'Stranger <who@else.org>', commits: 1 }])
  assert.equal(summary.byMonth['2025-11'].all.uniqueCommits, 12)
  assert.ok(summary.byWeek['2025-W44'])
  assert.equal(t0.topCodeDirs[0].dir, 'src')
  assert.equal(summary.baseline.byIdentity.owner.commits, 1)
  assert.equal(summary.baseline.byIdentity.owner.linesAdded, 1)
  assert.ok(summary.baseline.byIdentity.owner.codeAdded <= summary.baseline.byIdentity.owner.linesAddedExclGiant)

  const all = JSON.parse(readFileSync(join(out, 'summary.all.json'), 'utf8'))
  assert.equal(all.totals.commits, 32)
  assert.equal(all.totals.uniqueCommits, 12, 'clone shares SHAs, so cross-repo copies are not double counted')
  assert.equal(all.ownerBaselineByRepo.fixture.commits, 1)
  assert.equal(all.ownerTotals.uniqueCommits, 10, 'all-repos owner totals exclude other identities')
  const combined = readFileSync(join(out, 'commits.jsonl'), 'utf8').trim().split('\n')
  assert.equal(combined.length, 32)
})
