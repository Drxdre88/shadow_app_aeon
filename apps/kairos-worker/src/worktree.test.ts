// Integration tests against a real throwaway git repo: the worktree module's
// whole job is git-side effects, so mocking git would test nothing. The
// junction-survival tests are the regression lock for the warden round-1
// criticals — `git worktree remove` traverses junctions and empties their
// targets, so destruction must never let a recursive delete meet a link.
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmdirSync, rmSync, unlinkSync, writeFileSync, lstatSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RepoEntry } from './registry.js'
import {
  createWorktree,
  deleteBranchIfEmpty,
  findLinks,
  git,
  GIT_TIMEOUT_MS,
  isMissionBranch,
  LOCK_TIMEOUT_MS,
  MISSION_BRANCH_PREFIX,
  missionCommits,
  pushBranch,
  removeWorktree,
  slugDir,
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

describe('isMissionBranch', () => {
  it('accepts only names inside the mission namespace', () => {
    expect(isMissionBranch('aeon/12ab34cd')).toBe(true)
    expect(isMissionBranch('aeon/mission-1')).toBe(true)
    expect(isMissionBranch(`${MISSION_BRANCH_PREFIX}deep/name`)).toBe(true)
  })

  it('refuses an operator branch, the default branch and traversal shapes', () => {
    for (const branch of [
      'feat/flight-deck',
      'main',
      'master',
      'aeon',
      'aeon/',
      'aeon//x',
      'aeon/../feat/flight-deck',
      'aeon/..',
      'AEON/x',
      'x/aeon/y',
      '',
      null,
      undefined,
    ]) {
      expect(isMissionBranch(branch)).toBe(false)
    }
  })
})

describe('slugDir', () => {
  it('leaves an ordinary slug untouched', () => {
    expect(slugDir('aeon')).toBe('aeon')
    expect(slugDir('shadow_app_aeon')).toBe('shadow_app_aeon')
    expect(slugDir('kairos-worker.v2')).toBe('kairos-worker.v2')
  })

  it('reduces any slug to a single non-traversing path component', () => {
    for (const bad of ['..', '.', '/', '../../escape', 'a/../..', 'C:/x', '\\\\server\\share', '...', '']) {
      const dir = slugDir(bad)
      expect(dir.split(/[\\/]/)).toHaveLength(1)
      expect(dir.startsWith('.')).toBe(false)
      expect(dir).not.toBe('..')
    }
    expect(slugDir('/')).toMatch(/^slug-[0-9a-f]{8}$/)
    expect(slugDir('..')).toMatch(/^slug-[0-9a-f]{8}$/)
  })

  it('keeps a traversal slug inside the worktree root', () => {
    // resolve() collapses any surviving '..', so still being under the root
    // after resolution is proof nothing climbed out of it
    const root = resolve(join(base, 'trees'))
    for (const slug of ['../../escape', '..', 'a/../../..']) {
      const path = resolve(worktreeDirFor({ ...entry, slug }, 'aeon/x'))
      expect(path.startsWith(root + sep)).toBe(true)
    }
  })
})

describe('repo lock timebox', () => {
  it('outlasts the worst-case locked git sequence', () => {
    // createLocked chains up to 9 sequential gitAsync calls inside the lock.
    // A shorter timebox releases the chain while `worktree add` is still
    // running, and the next op's `worktree prune` then unregisters it.
    expect(LOCK_TIMEOUT_MS).toBeGreaterThan(9 * GIT_TIMEOUT_MS)
  })
})

describe('worktree lifecycle', () => {
  it('refuses a branch outside the mission namespace without touching git', async () => {
    // an operator branch that really exists in this repo
    git(entry.path, ['branch', 'feat/operator-work'])
    const res = await createWorktree(entry, 'feat/operator-work')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('mission namespace')
    // nothing created, and the operator branch is not checked out anywhere
    expect(existsSync(worktreeDirFor(entry, 'feat/operator-work'))).toBe(false)
    expect(git(entry.path, ['worktree', 'list']).stdout).not.toContain('feat/operator-work')
    // …and it still points where it did, with no worktree registered on it
    expect(git(entry.path, ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/operator-work']).ok).toBe(true)
  })

  it('refuses the default branch and a traversal branch', async () => {
    for (const branch of ['main', 'aeon/../feat/operator-work']) {
      const res = await createWorktree(entry, branch)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toContain('mission namespace')
      expect(existsSync(worktreeDirFor(entry, branch))).toBe(false)
    }
  })

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
    const scan = findLinks(res.path)
    expect(scan.ok).toBe(true)
    expect(scan.links.length).toBeGreaterThan(0)

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
    // simulate `npm ci`: junction replaced by a real directory. The seeded
    // link is a junction on Windows (removed with rmdir) but a plain symlink
    // elsewhere (rmdir → ENOTDIR; it needs unlink) — CI runs on Linux.
    const seededLink = join(res.path, 'node_modules')
    if (process.platform === 'win32') rmdirSync(seededLink)
    else unlinkSync(seededLink)
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

  it('excludes a copied env file the repo does not already ignore', async () => {
    // .gitignore covers .env.local but not this one — a mission `git add -A`
    // would otherwise stage a live credential onto a branch teardown pushes.
    writeFileSync(join(entry.path, 'secrets.env'), 'TOKEN=live\n')
    const seeded: RepoEntry = { ...entry, slug: 'demo-exclude', link: [], copy: ['secrets.env'] }

    const res = await createWorktree(seeded, 'aeon/env-guard')
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(existsSync(join(res.path, 'secrets.env'))).toBe(true)
    // git itself now ignores it, inside the mission worktree
    expect(git(res.path, ['check-ignore', '-q', 'secrets.env']).ok).toBe(true)
    expect(git(res.path, ['status', '--porcelain']).stdout).not.toContain('secrets.env')

    const excludeFile = git(res.path, ['rev-parse', '--git-path', 'info/exclude']).stdout.trim()
    const before = readFileSync(excludeFile, 'utf8')
    expect(before).toContain('/secrets.env')

    // idempotent: a second mission must not append the rule again
    await removeWorktree(seeded, 'aeon/env-guard')
    const again = await createWorktree(seeded, 'aeon/env-guard')
    expect(again.ok).toBe(true)
    expect(readFileSync(excludeFile, 'utf8')).toBe(before)

    await removeWorktree(seeded, 'aeon/env-guard')
    await deleteBranchIfEmpty(seeded, 'aeon/env-guard')
    rmSync(join(entry.path, 'secrets.env'), { force: true })
  })

  it('leaves an already-ignored copy alone', async () => {
    const res = await createWorktree(entry, 'aeon/ignored-copy')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const excludeFile = git(res.path, ['rev-parse', '--git-path', 'info/exclude']).stdout.trim()
    const exclude = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : ''
    expect(exclude).not.toContain('/.env.local')
    await removeWorktree(entry, 'aeon/ignored-copy')
    await deleteBranchIfEmpty(entry, 'aeon/ignored-copy')
  })

  it('refuses the recursive delete when the link scan could not read the tree', async () => {
    // A tree the scan cannot walk end to end is NOT a link-free tree: refusing
    // is the whole point of the guard, because rmSync(recursive) would
    // otherwise run over an unscanned subtree.
    const path = worktreeDirFor(entry, 'aeon/unscannable')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'not a directory — readdir throws ENOTDIR\n')

    const destroyed = await removeWorktree(entry, 'aeon/unscannable')
    expect(destroyed.removed).toBe(false)
    expect(existsSync(path)).toBe(true) // left in place for a manual sweep

    rmSync(path, { force: true })
  })
})

describe('findLinks', () => {
  it('reports a scan it could not perform instead of an empty result', () => {
    const scan = findLinks(join(base, 'does-not-exist'))
    expect(scan.ok).toBe(false)
    expect(scan.links).toEqual([])
    expect(scan.unscanned.length).toBeGreaterThan(0)
  })

  it('records a junction pointing outside the tree and never descends into it', () => {
    const outside = join(base, 'outside')
    mkdirSync(join(outside, 'inner'), { recursive: true })
    writeFileSync(join(outside, 'inner', 'keep.txt'), 'irreplaceable\n')
    symlinkSync(join(outside, 'inner'), join(outside, 'inner-link'), 'junction')

    const tree = join(base, 'scanme')
    mkdirSync(join(tree, 'nested'), { recursive: true })
    const link = join(tree, 'nested', 'linked')
    symlinkSync(outside, link, 'junction')

    const scan = findLinks(tree)
    expect(scan.ok).toBe(true)
    expect(scan.links).toContain(link)
    // the link was recorded, not entered: nothing behind it appears
    expect(scan.links.some((p) => p.startsWith(link + sep))).toBe(false)
    expect(existsSync(join(outside, 'inner', 'keep.txt'))).toBe(true)
  })

  it('scans a tree reached through a symlinked parent without calling it an escape', () => {
    const real = join(base, 'real-tree')
    mkdirSync(join(real, 'sub'), { recursive: true })
    writeFileSync(join(real, 'sub', 'file.txt'), 'x\n')
    const alias = join(base, 'alias-tree')
    symlinkSync(real, alias, 'junction')

    const scan = findLinks(alias)
    expect(scan.ok).toBe(true)
    expect(scan.unscanned).toEqual([])
    expect(scan.links).toEqual([])
  })
})
