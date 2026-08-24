// Integration tests against a real throwaway git repo: the worktree module's
// whole job is git-side effects, so mocking git would test nothing.
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RepoEntry } from './registry.js'
import {
  branchAhead,
  createWorktree,
  deleteBranchIfEmpty,
  git,
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
  it('flattens branch separators into one safe path component', () => {
    expect(worktreeDirFor(entry, 'aeon/12ab34cd')).toBe(join(base, 'trees', 'demo', 'aeon-12ab34cd'))
  })
})

describe('worktree lifecycle', () => {
  it('creates a worktree on a new branch without touching the live checkout', () => {
    const before = git(entry.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
    const res = createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(existsSync(join(res.path, 'readme.md'))).toBe(true)
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

  it('refuses a second mission on the same branch — path exclusivity', () => {
    const res = createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('already exists')
  })

  it('counts commits ahead and keeps the pushed-branch guardrails', () => {
    const path = worktreeDirFor(entry, 'aeon/mission1')
    expect(branchAhead(entry, 'aeon/mission1')).toBe(0)
    writeFileSync(join(path, 'fix.md'), 'fixed\n')
    sh(path, ['add', 'fix.md'])
    sh(path, ['commit', '-m', 'mission fix'])
    expect(branchAhead(entry, 'aeon/mission1')).toBe(1)
    expect(branchAhead(entry, 'main')).toBe(0)
  })

  it('removes the worktree without nuking the live node_modules through the junction', () => {
    removeWorktree(entry, 'aeon/mission1')
    expect(existsSync(worktreeDirFor(entry, 'aeon/mission1'))).toBe(false)
    // the real dependency dir behind the junction is intact
    expect(existsSync(join(entry.path, 'node_modules', 'dep.js'))).toBe(true)
    // branch survives — it holds the mission's commit
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/mission1']).ok).toBe(true)
  })

  it('reuses an existing mission branch in a fresh worktree on re-run', () => {
    const res = createWorktree(entry, 'aeon/mission1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(existsSync(join(res.path, 'fix.md'))).toBe(true)
    removeWorktree(entry, 'aeon/mission1')
  })

  it('deleteBranchIfEmpty drops only empty non-default branches', () => {
    const res = createWorktree(entry, 'aeon/empty1')
    expect(res.ok).toBe(true)
    removeWorktree(entry, 'aeon/empty1')
    deleteBranchIfEmpty(entry, 'aeon/empty1')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/empty1']).ok).toBe(false)
    // a branch with commits is refused
    deleteBranchIfEmpty(entry, 'aeon/mission1')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/aeon/mission1']).ok).toBe(true)
    // the default branch is never touched
    deleteBranchIfEmpty(entry, 'main')
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok).toBe(true)
  })

  it('removal is idempotent when the worktree is already gone', () => {
    expect(() => removeWorktree(entry, 'aeon/mission1')).not.toThrow()
  })
})
