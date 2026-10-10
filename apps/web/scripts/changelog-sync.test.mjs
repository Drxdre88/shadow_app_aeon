import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PATHS,
  escapeTemplate,
  expectedFiles,
  findPrivateImporters,
  findPrivateTerms,
  parseCommit,
  renderDraft,
  routeCommit,
  runCheck,
} from './changelog-sync.mjs'

const PUBLIC_MD = '# Changelog\n\n## [1.2.0] — 2026-10-10\n\n### Added · `BOARD`\n- Cards show `code` and ${x} safely.\n'
const PRIVATE_MD = '# Vorath Changelog\n\n## [0.5.0] — 2026-10-10 · "Recall"\n\n- Vorath remembers.\n'

function fakeRepo(overrides = {}) {
  const files = {
    [PATHS.publicMd]: PUBLIC_MD,
    [PATHS.privateMd]: PRIVATE_MD,
    [PATHS.kairosVersionTs]: "export const KAIROS_VERSION = '0.5.0'\n",
    ...overrides,
  }
  const read = (p) => files[p] ?? null
  for (const f of expectedFiles(read)) if (!(f.path in overrides)) files[f.path] = f.content
  return read
}

test('routeCommit sends Vorath scopes private and product scopes public', () => {
  for (const s of [
    'feat(kairos): one search core',
    'fix(vorath): owner lock',
    'feat(dominion): focus',
    'feat(aether): x',
    'fix(telegram): reply-to',
    'feat(brain): y',
    'feat(hangar): payback',
    'test(eval): relabel fixtures',
    'fix(capture): skip stale sessions',
    'feat(board,kairos): mixed scope goes private',
  ]) assert.equal(routeCommit(s), 'private', s)
  for (const s of [
    'feat(board): archive board switch',
    'fix(db): read-only drift gate',
    'fix(auth): magic link',
    'docs(aeon): refresh architecture',
    'chore: bump deps',
  ]) assert.equal(routeCommit(s), 'public', s)
})

test('routeCommit sends an unscoped commit naming Vorath private', () => {
  assert.equal(routeCommit('feat: Vorath checks finished missions'), 'private')
  assert.equal(routeCommit('docs(aeon): handover — Kairos 0.26 live'), 'private')
  assert.equal(routeCommit('Merge branch main'), 'public')
})

test('parseCommit reads type, scopes and breaking marker', () => {
  assert.deepEqual(parseCommit('feat(board, ui)!: big change'), { type: 'feat', scopes: ['board', 'ui'], breaking: true, description: 'big change' })
  assert.equal(parseCommit('not conventional').type, null)
})

test('renderDraft splits commits and groups them by section', () => {
  const d = renderDraft([
    { hash: 'a1', subject: 'feat(board): likely finish dates' },
    { hash: 'b2', subject: 'fix(kairos): vector search' },
    { hash: 'c3', subject: 'fix(gantt): reset asks first' },
  ])
  assert.deepEqual(d.counts, { public: 2, private: 1 })
  assert.match(d.public, /### Added\n- likely finish dates \(a1\)/)
  assert.match(d.public, /### Fixed\n- reset asks first \(c3\)/)
  assert.match(d.public, /Areas touched: `BOARD` `GANTT`/)
  assert.doesNotMatch(d.public, /vector search/)
  assert.match(d.private, /- vector search \(b2\)/)
})

test('findPrivateTerms catches the private vocabulary, case-insensitively', () => {
  const text = 'Board fix\nkairos pill\nThe AETHER view\nThinking jobs ran\nmemories filed\nDominion editor\nNotes on memory'
  assert.deepEqual(findPrivateTerms(text).map((h) => h.line), [2, 3, 4, 5, 6])
  assert.deepEqual(findPrivateTerms('the Hangar door', ['hangar door']), [])
})

test('escapeTemplate keeps backticks, backslashes and ${ literal', () => {
  const md = 'a `b` \\c ${d}'
  assert.equal(new Function(`return \`${escapeTemplate(md)}\``)(), md)
})

test('runCheck passes on a synced, clean repo', () => {
  assert.deepEqual(runCheck(fakeRepo(), []), [])
})

test('runCheck tolerates CRLF working copies', () => {
  const base = fakeRepo()
  const read = (p) => (p === PATHS.changelogTs ? base(p).replace(/\n/g, '\r\n') : base(p))
  assert.deepEqual(runCheck(read, []), [])
})

test('runCheck flags drift between the markdown and the generated files', () => {
  const errors = runCheck(fakeRepo({ [PATHS.versionTs]: "export const APP_VERSION = '1.1.0'\n" }), [])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /version\.ts is out of date/)
})

test('runCheck flags private content in the public log', () => {
  const leaked = PUBLIC_MD + '- Vorath now sorts cards.\n'
  const errors = runCheck(fakeRepo({ [PATHS.publicMd]: leaked }), [])
  assert.ok(errors.some((e) => e.startsWith(`${PATHS.publicMd}:7 mentions "Vorath"`)), errors.join('\n'))
  assert.ok(errors.some((e) => e.startsWith(`${PATHS.changelogTs}:`)), 'generated copy is checked too')
})

test('runCheck flags a KAIROS_VERSION that drifts from the private log', () => {
  const errors = runCheck(fakeRepo({ [PATHS.kairosVersionTs]: "export const KAIROS_VERSION = '0.4.0'\n" }), [])
  assert.deepEqual(errors, ["KAIROS_VERSION (0.4.0) does not match the private log's top version (0.5.0)"])
})

test('only the server action may import the private module', () => {
  const files = [
    { path: PATHS.privateAction, content: "import { PRIVATE_CHANGELOG_MD } from '@/lib/changelog-private'" },
    { path: 'apps/web/src/components/ui/ChangelogModal.tsx', content: "import { getPrivateChangelog } from '@/lib/actions/changelog-private'" },
    { path: 'apps/web/src/components/ui/Leaky.tsx', content: "'use client'\nimport { PRIVATE_CHANGELOG_MD } from '@/lib/changelog-private'" },
    { path: 'apps/web/src/lib/other.ts', content: "const m = await import('./changelog-private')" },
    { path: 'apps/web/src/lib/actions/also.ts', content: "import x from '../changelog-private'" },
  ]
  assert.deepEqual(findPrivateImporters(files), [
    'apps/web/src/components/ui/Leaky.tsx',
    'apps/web/src/lib/other.ts',
    'apps/web/src/lib/actions/also.ts',
  ])
  assert.equal(runCheck(fakeRepo(), files).length, 3)
})

test('the generated private module is server-only and carries its version', () => {
  const priv = expectedFiles(fakeRepo()).find((f) => f.path === PATHS.privateTs).content
  assert.match(priv, /^import 'server-only'$/m)
  assert.match(priv, /PRIVATE_CHANGELOG_VERSION = '0\.5\.0'/)
})
