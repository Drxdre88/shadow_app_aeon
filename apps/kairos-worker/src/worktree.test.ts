// Integration tests against a real throwaway git repo: the worktree module's
// whole job is git-side effects, so mocking git would test nothing. The
// junction-survival tests are the regression lock for the warden round-1
// criticals — `git worktree remove` traverses junctions and empties their
// targets, so destruction must never let a recursive delete meet a link.
import { mkdtempSync, mkdirSync, existsSync, rmdirSync, rmSync, writeFileSync, lstatSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RepoEntry } from './registry.js'
import {
  createWorktree,
  deleteBranchIfEmpty,
  findLinks,
  git,
  missionCommits,
  pushBranch,
  removeWorktree,
  worktreeDirFor,
} from './worktree.js'

let base = ''
let entry: RepoEntry

function sh(cwd: string, args: string[]): void {
  const res = git(cwd, args)
  if (!res.ok) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'aeon-worktree-test-'))
  const repo = join(base, 'repo')
  mkdirSync(repo)
  sh(repo, ['init', '-b', 'main'])
  sh(repo, ['config', 'user.email', 'test@test'])
  sh(repo, ['config', 'user.name', 'test'])
  writeFileSync(join(repo, 'readme.md'), 'hello\n')
  mkdirSync(join(repo, 'node_modules'))
  writeFileSync(join(repo, 'node_modules', 'dep.js'), 'x\n')
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env.local\n')
  writeFileSync(join(repo, '.env.local'), 'SECRET=1\n')
  sh(repo, ['add', '.'])
  sh(repo, ['commit', '-m', 'init'])
  process.env.KAIROS_WORKTREE_ROOT = join(base, 'trees')
  entry = {
    slug: 'demo',
    path: repo,
    defaultBranch: 'main',
    envSetupCmd: null,
    link: ['node_modules'],
    copy: ['.env.local'],
  }
})

afterAll(() => {
  delete process.env.KAIROS_WORKTREE_ROOT
  rmSync(base, { recursive: true, force: true })
})

describe('worktreeDirFor', () => {
  it('flattens branch separators and disambiguates with a digest', () => {
    const a = worktreeDirFor(entry, 'aeon/12ab34cd')
    const b = worktreeDirFor(entry, 'aeon-12ab34cd')
    expect(a.startsWith(join(base, 'trees', 'demo', 'aeon-12ab34cd-'))).toBe(true)
    // same sanitized stem, different branches -> different directories
    expect(a).not.toBe(b)
  })
})

describe('worktree lifecycle', () => {
  it('creates a worktree on a new branch without touching the live checkout', async () => {
    const before = git(entry.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
    const res = await createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(existsSync(join(res.path, 'readme.md'))).toBe(true)
    expect(res.startSha).toMatch(/^[0-9a-f]{40}$/)
    expect(git(res.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('aeon/mission1')
    // live checkout still where it was
    expect(git(entry.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe(before)
  })

  it('seeds junctions for link dirs and copies for copy files', () => {
    const path = worktreeDirFor(entry, 'aeon/mission1')
    expect(lstatSync(join(path, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(path, 'node_modules', 'dep.js'))).toBe(true)
    expect(existsSync(join(path, '.env.local'))).toBe(true)
    expect(lstatSync(join(path, '.env.local')).isSymbolicLink()).toBe(false)
  })

  it('refuses a second mission on the same branch — path exclusivity', async () => {
    const res = await createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('already exists')
    expect(res.error).toContain('worktree prune')
  })

  it('counts only commits the mission added, from its start tip', async () => {
    const path = worktreeDirFor(entry, 'aeon/mission1')
    const start = git(path, ['rev-parse', 'HEAD']).stdout.trim()
    expect(await missionCommits(entry, 'aeon/mission1', start)).toBe(0)
    writeFileSync(join(path, 'fix.md'), 'fixed\n')
    sh(path, ['add', 'fix.md'])
    sh(path, ['commit', '-m', 'mission fix'])
    expect(await missionCommits(entry, 'aeon/mission1', start)).toBe(1)
    // a pre-existing branch measured from its own tip shows zero mission work
    expect(await missionCommits(entry, 'aeon/mission1', git(entry.path, ['rev-parse', 'aeon/mission1']).stdout.trim())).toBe(0)
    expect(await missionCommits(entry, 'main', null)).toBe(0)
  })

  it('removes the worktree without nuking the live node_modules through the junction', async () => {
    const destroyed = await removeWorktree(entry, 'aeon/mission1')
    expect(destroyed.removed).toBe(true)
    expect(destroyed.depsMutated).toBe(false)
    expect(existsSync(worktreeDirFor(entry, 'aeon/mission1'))).toBe(false)
    // the real dependency dir behind the junction is intact
    expect(existsSync(join(entry.path, 'node_modules', 'dep.js'))).toBe(true)
    // branch survives — it holds the mission's commit
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/mission1']).ok).toBe(true)
  })

  it('survives a MISSION-created junction the runner never seeded (warden #2 regression)', async () => {
    const precious = join(base, 'precious')
    mkdirSync(precious)
    writeFileSync(join(precious, 'keep.txt'), 'irreplaceable\n')

    const res = await createWorktree(entry, 'aeon/rogue')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // the agent linked something up on its own, deep in the tree
    mkdirSync(join(res.path, 'apps', 'web'), { recursive: true })
    symlinkSync(precious, join(res.path, 'apps', 'web', 'node_modules'), 'junction')
    expect(findLinks(res.path).length).toBeGreaterThan(0)

    const destroyed = await removeWorktree(entry, 'aeon/rogue')
    expect(destroyed.removed).toBe(true)
    // the junction target survived the teardown
    expect(existsSync(join(precious, 'keep.txt'))).toBe(true)
    await deleteBranchIfEmpty(entry, 'aeon/rogue')
  })

  it('flags a mission that replaced the shared dependency dir', async () => {
    const res = await createWorktree(entry, 'aeon/mutator')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // simulate `npm ci`: junction replaced by a real directory
    rmdirSync(join(res.path, 'node_modules'))
    mkdirSync(join(res.path, 'node_modules'))
    writeFileSync(join(res.path, 'node_modules', 'own.js'), 'y\n')

    const destroyed = await removeWorktree(entry, 'aeon/mutator')
    expect(destroyed.removed).toBe(true)
    expect(destroyed.depsMutated).toBe(true)
    // live deps untouched
    expect(existsSync(join(entry.path, 'node_modules', 'dep.js'))).toBe(true)
    await deleteBranchIfEmpty(entry, 'aeon/mutator')
  })

  it('reuses an existing mission branch in a fresh worktree on re-run', async () => {
    const res = await createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(existsSync(join(res.path, 'fix.md'))).toBe(true)
    await removeWorktree(entry, 'aeon/mission1')
  })

  it('cleans up after a failed worktree add so the card is not blocked forever', async () => {
    const res = await createWorktree(entry, 'aeon/mission1x')
    expect(res.ok).toBe(true)
    // same BRANCH in a second worktree fails inside git (checked out elsewhere)
    const dup = await createWorktree({ ...entry, slug: 'demo2' }, 'aeon/mission1x')
    expect(dup.ok).toBe(false)
    // …but its debris is cleared: a later attempt fails for the same git
    // reason, not at the exists-refusal
    const again = await createWorktree({ ...entry, slug: 'demo2' }, 'aeon/mission1x')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error).not.toContain('already exists')
    await removeWorktree(entry, 'aeon/mission1x')
    await deleteBranchIfEmpty(entry, 'aeon/mission1x')
  })

  it('deleteBranchIfEmpty drops only empty non-default branches', async () => {
    const res = await createWorktree(entry, 'aeon/empty1')
    expect(res.ok).toBe(true)
    await removeWorktree(entry, 'aeon/empty1')
    await deleteBranchIfEmpty(entry, 'aeon/empty1')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/empty1']).ok).toBe(false)
    // a branch with commits is refused
    await deleteBranchIfEmpty(entry, 'aeon/mission1')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/mission1']).ok).toBe(true)
    // the default branch is never touched
    await deleteBranchIfEmpty(entry, 'main')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok).toBe(true)
  })

  it('push without origin reports failure without throwing', async () => {
    const res = await pushBranch(entry, 'aeon/mission1')
    expect(res.ok).toBe(false)
  })

  it('removal is idempotent when the worktree is already gone', async () => {
    const destroyed = await removeWorktree(entry, 'aeon/mission1')
    expect(destroyed.removed).toBe(true)
  })
})
