// Unit tests for the living-world freshness rules. Run: npm run test:freshness
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ageLevel,
  bumpKind,
  checkArchitectureLag,
  checkModels,
  checkVersions,
  constVersion,
  currentModelIds,
  daysBetween,
  extractModelLiterals,
  globToRegExp,
  newestHistoryDate,
  renderReport,
  scanRetiredTerms,
  summariseOutdated,
  topChangelogVersion,
  unmentionedFolders,
} from '../freshness/lib.mjs'

describe('age thresholds', () => {
  it('is green up to and including the yellow threshold, then yellow, then red', () => {
    assert.equal(ageLevel(0, 45, 90), 'green')
    assert.equal(ageLevel(45, 45, 90), 'green')
    assert.equal(ageLevel(46, 45, 90), 'yellow')
    assert.equal(ageLevel(90, 45, 90), 'yellow')
    assert.equal(ageLevel(91, 45, 90), 'red')
    assert.equal(ageLevel(NaN, 45, 90), 'red')
  })

  it('counts whole days between dates', () => {
    assert.equal(daysBetween('2026-01-01', '2026-02-15'), 45)
    assert.equal(daysBetween('2026-01-01', new Date('2026-01-01T23:00:00Z')), 0)
    assert.ok(Number.isNaN(daysBetween('not a date', '2026-01-01')))
  })

  const registry = (reviewedAt, extra = {}) => ({
    reviewedAt,
    models: [
      { provider: 'anthropic', id: 'claude-new-5', engineIds: { copilot: 'claude-new.5' }, status: 'current' },
      { provider: 'anthropic', id: 'claude-old-3', status: 'legacy' },
    ],
    defaults: { chat: { provider: 'anthropic', model: 'claude-new-5', effort: 'high' } },
    legacyRemap: { 'claude-ancient-2': 'claude-new-5' },
    ...extra,
  })
  const now = new Date('2026-10-02T12:00:00Z')

  it('grades the model registry review age 45 / 90 days', () => {
    assert.equal(checkModels(registry('2026-09-01'), now)[0].level, 'green')
    assert.equal(checkModels(registry('2026-08-01'), now)[0].level, 'yellow')
    assert.equal(checkModels(registry('2026-06-01'), now)[0].level, 'red')
    assert.equal(checkModels(registry(undefined), now)[0].level, 'red')
  })

  it('handles a missing registry gracefully', () => {
    const f = checkModels(null, now)
    assert.equal(f.length, 1)
    assert.equal(f[0].level, 'yellow')
  })

  it('lists legacy models used as defaults', () => {
    const f = checkModels(
      registry('2026-09-30', { defaults: { chat: { model: 'claude-new-5' }, cheap: { model: 'claude-old-3' }, x: { model: 'claude-ancient-2' } } }),
      now,
    )
    assert.equal(f[1].level, 'yellow')
    assert.deepEqual(f[1].details, ['claude-old-3', 'claude-ancient-2'])
  })

  it('separates current, retired (remapped) and unregistered model literals', () => {
    const src = [
      "const a = 'claude-new-5'",
      'const b = "claude-ancient-2"',
      'const c = `gpt-9-turbo`',
      "const tool = 'claude-code'",
      "const label = 'GPT-9 Turbo'",
      "const o = 'o3'",
      "const engine = 'claude-new.5'",
    ].join('\n')
    const hits = extractModelLiterals(src).map((h) => ({ file: 'x.ts', ...h }))
    assert.deepEqual(hits.map((h) => h.id), ['claude-new-5', 'claude-ancient-2', 'gpt-9-turbo', 'o3', 'claude-new.5'])
    const [, , retired, unknown] = checkModels(registry('2026-09-30'), now, hits)
    assert.equal(retired.level, 'yellow')
    assert.deepEqual(retired.details, ['x.ts:2 — `claude-ancient-2` → claude-new-5'])
    assert.equal(unknown.level, 'yellow')
    assert.deepEqual(unknown.details, ['x.ts:3 — `gpt-9-turbo`', 'x.ts:6 — `o3`'])
  })

  it('skips model literals on lines marked freshness-ignore', () => {
    const src = ["const a = 'claude-ancient-2' // freshness-ignore: column default", "const b = 'claude-ancient-2'"].join('\n')
    assert.deepEqual(extractModelLiterals(src), [{ id: 'claude-ancient-2', line: 2 }])
  })

  it('is all green for a fresh registry and registered literals', () => {
    const hits = [{ file: 'y.ts', line: 1, id: 'claude-new-5' }]
    assert.deepEqual(checkModels(registry('2026-10-01'), now, hits).map((f) => f.level), ['green', 'green', 'green', 'green'])
  })
})

describe('retired-term scan', () => {
  const config = {
    terms: ['run_recipe', 'Morning Brief', 'gpt-5.'],
    scan: ['docs/kairos/25-*.md', 'apps/web/src/components/**/*Guide*', 'architecture/**'],
    allow: ['architecture/history.md'],
    ignoreLines: ['freshness-ignore', '\\bretired\\b'],
  }

  it('reports file:line hits only in scanned, non-allow-listed files', () => {
    const files = [
      { path: 'docs/kairos/25-guide.md', text: 'intro\nUse run_recipe to start\nYour MORNING BRIEF arrives' },
      { path: 'architecture/history.md', text: 'run_recipe was removed' },
      { path: 'docs/kairos/12-old-spec.md', text: 'run_recipe everywhere' },
      { path: 'apps/web/src/components/kairos/KairosGuideContent.tsx', text: '<p>morning brief</p>' },
    ]
    const hits = scanRetiredTerms(files, config)
    assert.deepEqual(
      hits.map((h) => `${h.path}:${h.line}:${h.term}`),
      [
        'docs/kairos/25-guide.md:2:run_recipe',
        'docs/kairos/25-guide.md:3:Morning Brief',
        'apps/web/src/components/kairos/KairosGuideContent.tsx:1:Morning Brief',
      ],
    )
  })

  it('skips ignore-marked history lines', () => {
    const files = [{ path: 'architecture/platform.md', text: 'run_recipe retired in 0.18\nrun_recipe <!-- freshness-ignore -->' }]
    assert.deepEqual(scanRetiredTerms(files, config), [])
  })

  it('does not flag a token that is a current registry model id', () => {
    const files = [{ path: 'architecture/hangar.md', text: 'reviewer gpt-5.6-sol\nold gpt-5.1 default' }]
    const hits = scanRetiredTerms(files, config, { currentModelIds: new Set(['gpt-5.6-sol']) })
    assert.deepEqual(hits.map((h) => h.line), [2])
    const reg = { models: [{ id: 'gpt-5.6-sol', status: 'current' }, { id: 'gpt-5.1', status: 'legacy' }] }
    assert.deepEqual([...currentModelIds(reg)], ['gpt-5.6-sol'])
  })

  it('globs: ** spans directories, * stays in one segment', () => {
    assert.ok(globToRegExp('architecture/**').test('architecture/kairos/overview.md'))
    assert.ok(globToRegExp('**/CHANGELOG*.md').test('CHANGELOG.md'))
    assert.ok(globToRegExp('**/CHANGELOG*.md').test('docs/kairos/CHANGELOG.md'))
    assert.ok(!globToRegExp('docs/kairos/25-*.md').test('docs/kairos/25-x/y.md'))
  })
})

describe('version consistency', () => {
  it('reads versions from source and changelog headings', () => {
    assert.equal(constVersion("export const APP_VERSION = '0.36.0'", 'APP_VERSION'), '0.36.0')
    assert.equal(topChangelogVersion('# Changelog\n\n## Legend\n\n## [0.36.0] — 2026-10-02\n## [0.35.0]'), '0.36.0')
    assert.equal(topChangelogVersion('no versions'), null)
  })

  it('is green when all agree and red on mismatch or missing', () => {
    const [ok, bad, missing] = checkVersions([
      { label: 'App', values: { a: '0.36.0', b: '0.36.0', c: '0.36.0' } },
      { label: 'Kairos', values: { a: '0.19.0', b: '0.18.0' } },
      { label: 'X', values: { a: null, b: null } },
    ])
    assert.equal(ok.level, 'green')
    assert.equal(bad.level, 'red')
    assert.match(bad.message, /MISMATCH/)
    assert.equal(missing.level, 'red')
  })
})

describe('architecture lag', () => {
  it('finds the newest dated heading and grades the lag 14 / 30 days', () => {
    assert.equal(newestHistoryDate('### 2026-09-01 — a\n### 2026-10-02 (evening) — b\n### 2026-08-01'), '2026-10-02')
    assert.equal(checkArchitectureLag('2026-10-01', '2026-10-10')[0].level, 'green')
    assert.equal(checkArchitectureLag('2026-09-01', '2026-09-20')[0].level, 'yellow')
    assert.equal(checkArchitectureLag('2026-08-01', '2026-09-20')[0].level, 'red')
    assert.equal(checkArchitectureLag('2026-10-05', '2026-10-01')[0].level, 'green')
    assert.equal(checkArchitectureLag(null, '2026-10-01')[0].level, 'red')
  })

  it('lists folders not mentioned in the docs', () => {
    const missing = unmentionedFolders(
      [
        { prefix: 'lib', name: 'kairos' },
        { prefix: 'lib', name: 'realtime' },
        { prefix: 'api', name: '[transport]' },
      ],
      'see lib/kairos/x.ts and app/api/[transport]/route.ts',
    )
    assert.deepEqual(missing, [{ prefix: 'lib', name: 'realtime' }])
  })
})

describe('outdated summariser', () => {
  const fixture = {
    next: { current: '16.0.1', wanted: '16.0.1', latest: '17.0.0', dependent: 'web' },
    react: { current: '19.1.0', wanted: '19.1.0', latest: '19.2.0', dependent: 'web' },
    '@ai-sdk/anthropic': { current: '0.9.0', wanted: '0.9.0', latest: '0.10.0', dependent: 'web' },
    typescript: [
      { current: '5.6.0', wanted: '5.6.0', latest: '5.9.2', dependent: 'web' },
      { current: '5.6.0', wanted: '5.6.0', latest: '5.9.2', dependent: 'kairos-worker' },
    ],
    'left-pad': { current: '1.0.0', wanted: '1.0.0', latest: '1.0.1', dependent: 'web' },
    'not-installed': { wanted: '1.0.0', latest: '2.0.0', dependent: 'web' },
    zod: { current: '3.0.0', wanted: '3.0.0', latest: '4.0.0', dependent: 'shared' },
  }

  it('counts majors and minors and orders the important packages', () => {
    const s = summariseOutdated(fixture)
    assert.equal(s.total, 6)
    assert.equal(s.majors, 3) // next, @ai-sdk/anthropic (0.x minor), zod
    assert.equal(s.minors, 2) // react, typescript (deduped across workspaces)
    assert.deepEqual(s.important.map((r) => r.name), ['next', 'react', '@ai-sdk/anthropic', 'typescript'])
    assert.deepEqual(s.important.find((r) => r.name === 'typescript').dependents, ['web', 'kairos-worker'])
  })

  it('tolerates empty output', () => {
    assert.deepEqual(summariseOutdated({}), { total: 0, majors: 0, minors: 0, important: [] })
    assert.deepEqual(summariseOutdated(undefined).total, 0)
  })

  it('classifies semver bumps', () => {
    assert.equal(bumpKind('1.2.3', '2.0.0'), 'major')
    assert.equal(bumpKind('1.2.3', '1.3.0'), 'minor')
    assert.equal(bumpKind('1.2.3', '1.2.4'), 'patch')
    assert.equal(bumpKind('0.2.3', '0.3.0'), 'major')
    assert.equal(bumpKind('2.0.0', '1.9.0'), 'none')
    assert.equal(bumpKind('git+x', '1.0.0'), 'unknown')
  })
})

describe('report', () => {
  it('renders the 🟢/🟡/🔴 summary line', () => {
    const { markdown, summary, counts } = renderReport([
      { title: 'A', findings: [{ level: 'green', message: 'ok', details: [] }, { level: 'red', message: 'bad', details: ['x'] }] },
      { title: 'B', note: 'report only', findings: [{ level: 'yellow', message: 'hm', details: [] }] },
    ])
    assert.equal(summary, '🟢 1 · 🟡 1 · 🔴 1')
    assert.deepEqual(counts, { green: 1, yellow: 1, red: 1 })
    assert.match(markdown, /## 🔴 A/)
    assert.match(markdown, /## 🟡 B/)
    assert.match(markdown, /_report only_/)
  })
})
