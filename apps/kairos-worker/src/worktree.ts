// Mission worktree lifecycle — every mission runs in a disposable `git
// worktree`, so the operator's live checkout is never branch-switched and a
// dirty tree is irrelevant instead of fatal. Ported from the Archon recon
// (docs/investigations/20260821-archon-mining-flight-deck.md, lane 3):
//   - create: fetch base → `git worktree add --no-track -b <branch> origin/<base>`
//   - re-runs reuse an existing mission branch in a fresh worktree
//   - ownership verification before adopting an existing directory
//   - idempotent destroy, NO cleanup-on-startup (kills sibling runners' missions)
//
// SAFETY INVARIANT (warden round 1, empirically proven 2026-08-24): `git
// worktree remove` — with or without --force — TRAVERSES junctions and empties
// their targets, while Node's fs.rmSync unlinks them. Destruction therefore
// never calls `git worktree remove`: junctions are dropped by hand, the whole
// tree is scanned for reparse points the MISSION may have created, and only a
// link-free tree is recursively deleted with fs.rmSync. A tree that still
// holds a link after best-effort unlinking is left in place for a manual sweep.
//
// Git invocations are async (execFile) so a slow fetch/push cannot stall the
// runner's heartbeats, and worktree admin ops are serialized per repo.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import type { RepoEntry } from './registry.js'

const execFileAsync = promisify(execFile)

export interface GitResult { ok: boolean; stdout: string; stderr: string }

// Sync variant — cheap local queries and test setup only. Anything on the
// mission hot path (fetch, push, worktree admin) must use gitAsync.
export function git(cwd: string, args: string[]): GitResult {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: (res.stderr ?? '') || (res.error ? res.error.message : ''),
  }
}

export async function gitAsync(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: (e.stderr ?? '').trim() || e.message || 'git failed' }
  }
}

// Worktree admin ops (add / prune / branch bookkeeping) on one repo must not
// interleave: prune during a sibling's add window can unregister it. Simple
// promise-chain mutex keyed by repo path — enough for one runner process;
// cross-process safety comes from one-runner-per-host topology.
const repoLocks = new Map<string, Promise<unknown>>()

export async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(repoPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  repoLocks.set(repoPath, next.then(() => undefined, () => undefined))
  return next
}

export function worktreeRoot(): string {
  return process.env.KAIROS_WORKTREE_ROOT ?? join(homedir(), '.aeon', 'worktrees')
}

// aeon/1d28f417 → aeon-1d28f417-<6-char digest>: one directory level per
// worktree, valid as a Windows path component, and the digest keeps distinct
// branches that sanitize identically (aeon/x vs aeon-x) from colliding.
export function worktreeDirFor(entry: RepoEntry, branch: string): string {
  const digest = createHash('sha1').update(branch).digest('hex').slice(0, 6)
  const flat = branch.replace(/[^A-Za-z0-9._-]+/g, '-')
  return join(worktreeRoot(), entry.slug, `${flat}-${digest}`)
}

export type WorktreeResult =
  | { ok: true; path: string; startSha: string }
  | { ok: false; error: string }

export async function createWorktree(entry: RepoEntry, branch: string): Promise<WorktreeResult> {
  return withRepoLock(entry.path, () => createLocked(entry, branch))
}

async function createLocked(entry: RepoEntry, branch: string): Promise<WorktreeResult> {
  const path = worktreeDirFor(entry, branch)

  // Ownership verification (Archon): an existing directory is never adopted or
  // cleaned — it means a concurrent mission on the same card, or debris a
  // human should look at. Path-exclusivity is the concurrency primitive.
  if (existsSync(path)) {
    return {
      ok: false,
      error: `worktree path ${path} already exists — another mission on this card may be live; `
        + `if it is debris, remove the folder and run "git -C ${entry.path} worktree prune", then re-run`,
    }
  }

  // Fetch is best-effort: a flaky network must not sink the mission.
  const fetched = await gitAsync(entry.path, ['fetch', 'origin'])
  if (!fetched.ok) console.warn(`[worker/worktree] git fetch origin failed in ${entry.slug}: ${fetched.stderr.trim()}`)

  mkdirSync(dirname(path), { recursive: true })

  // A re-run reuses the existing mission branch; a first run branches from the
  // remote default, falling back to the local one on fetch-less hosts.
  let added: GitResult
  if ((await gitAsync(entry.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok) {
    added = await gitAsync(entry.path, ['worktree', 'add', path, branch])
  } else {
    added = await gitAsync(entry.path, ['worktree', 'add', '--no-track', '-b', branch, path, `origin/${entry.defaultBranch}`])
    if (!added.ok) added = await gitAsync(entry.path, ['worktree', 'add', '-b', branch, path, entry.defaultBranch])
  }
  if (!added.ok) {
    // A half-created target would block this card forever at the existsSync
    // refusal above — clear the debris while it is provably link-free.
    try { rmSync(path, { recursive: true, force: true }) } catch { /* nothing to clear */ }
    await gitAsync(entry.path, ['worktree', 'prune'])
    return { ok: false, error: `git worktree add failed for ${branch}: ${added.stderr.trim()}` }
  }

  seedIgnored(entry, path)

  const head = await gitAsync(path, ['rev-parse', 'HEAD'])
  if (!head.ok) {
    await destroyLocked(entry, branch)
    return { ok: false, error: `could not read worktree HEAD: ${head.stderr.trim()}` }
  }
  return { ok: true, path, startSha: head.stdout.trim() }
}

// A fresh worktree holds no git-ignored files, so tests inside it would die on
// a cold folder. Dependency dirs are junctioned (huge, and missions must treat
// them as read-only — an install would write through into the live checkout);
// env files are copied. Relative paths only — the registry is operator-owned,
// but a stray absolute or traversal entry must not reach outside the trees.
function safeRel(rel: string): boolean {
  return !!rel && !isAbsolute(rel) && !rel.split(/[\\/]/).includes('..')
}

function seedIgnored(entry: RepoEntry, path: string): void {
  for (const rel of entry.link) {
    if (!safeRel(rel)) continue
    const target = join(entry.path, rel)
    const at = join(path, rel)
    try {
      if (!existsSync(target) || existsSync(at)) continue
      mkdirSync(dirname(at), { recursive: true })
      symlinkSync(target, at, 'junction')
    } catch (err) {
      console.warn(`[worker/worktree] link ${rel} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const rel of entry.copy) {
    if (!safeRel(rel)) continue
    const from = join(entry.path, rel)
    const to = join(path, rel)
    try {
      if (!existsSync(from) || existsSync(to)) continue
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
    } catch (err) {
      console.warn(`[worker/worktree] copy ${rel} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// Unlinks a symlink/junction WITHOUT touching what it points at. rmdirSync
// handles Windows junctions; unlinkSync handles POSIX dir symlinks (rmdirSync
// throws ENOTDIR there, which would silently void the guard).
function dropLink(at: string): boolean {
  try {
    if (!lstatSync(at).isSymbolicLink()) return false
    try { rmdirSync(at) } catch { unlinkSync(at) }
    return true
  } catch {
    return false
  }
}

// Every reparse point anywhere in the tree — including ones the MISSION
// created (npm link, mklink); the destroy guard must reflect what is actually
// on disk, not what the runner seeded. readdirSync does not follow symlinks,
// so the scan cannot wander into the live checkout.
export function findLinks(root: string): string[] {
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((d) => d.isSymbolicLink())
      .map((d) => join(d.parentPath, d.name))
  } catch {
    return []
  }
}

export interface DestroyResult { removed: boolean; depsMutated: boolean }

export async function removeWorktree(entry: RepoEntry, branch: string): Promise<DestroyResult> {
  return withRepoLock(entry.path, () => destroyLocked(entry, branch))
}

async function destroyLocked(entry: RepoEntry, branch: string): Promise<DestroyResult> {
  const path = worktreeDirFor(entry, branch)
  let depsMutated = false

  if (existsSync(path)) {
    // 1. Seeded junctions by hand. A configured link that is no longer a link
    //    means the mission replaced the shared dependency dir — loud flag.
    for (const rel of entry.link) {
      if (!safeRel(rel)) continue
      const at = join(path, rel)
      try {
        if (existsSync(at) && !lstatSync(at).isSymbolicLink()) depsMutated = true
      } catch { /* unreadable — the scan below decides */ }
      dropLink(at)
    }

    // 2. Anything the mission linked up on its own.
    for (const link of findLinks(path)) dropLink(link)

    // 3. Verify link-free, else refuse: no recursive delete — git's or ours —
    //    may run over a tree that still holds a reparse point.
    const leftover = findLinks(path)
    if (leftover.length > 0) {
      console.error(`[worker/worktree] ${path} still holds a link (${leftover[0]}) — refusing recursive delete, manual sweep needed`)
      return { removed: false, depsMutated }
    }

    // 4. Our own delete — NEVER `git worktree remove`, which traverses
    //    junctions (proven on git 2.52 Windows). Rename-then-delete frees the
    //    mission path even when Windows still holds a handle somewhere inside.
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
    } catch {
      const trash = `${path}.trash-${Date.now()}`
      try {
        renameSync(path, trash)
        rmSync(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
      } catch (err) {
        console.warn(`[worker/worktree] could not fully remove ${path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  await gitAsync(entry.path, ['worktree', 'prune'])
  return { removed: !existsSync(path), depsMutated }
}

// Commits the mission itself added: from the tip captured at worktree creation
// to the branch head. Falls back to distance-from-base when no start tip is
// known (never for new missions; defensive for legacy sessions).
export async function missionCommits(entry: RepoEntry, branch: string, startSha: string | null): Promise<number> {
  let base = startSha
  if (!base) {
    const remote = `origin/${entry.defaultBranch}`
    base = (await gitAsync(entry.path, ['rev-parse', '--verify', '--quiet', remote])).ok ? remote : entry.defaultBranch
  }
  const res = await gitAsync(entry.path, ['rev-list', '--count', `${base}..${branch}`])
  const n = Number(res.stdout.trim())
  return res.ok && Number.isFinite(n) ? n : 0
}

// No -u: a disposable worktree gains nothing from an upstream ref, and
// parallel `push -u` teardowns contend on .git/config.lock.
export async function pushBranch(entry: RepoEntry, branch: string): Promise<GitResult> {
  return gitAsync(entry.path, ['push', 'origin', branch])
}

// A mission that produced no commits leaves no branch litter behind. Never
// touches the default branch; refuses a branch that is ahead of base (it may
// be pre-existing operator work); and -d (not -D) makes git itself refuse
// anything unmerged as the last line of defence.
export async function deleteBranchIfEmpty(entry: RepoEntry, branch: string): Promise<void> {
  if (branch === entry.defaultBranch) return
  if ((await missionCommits(entry, branch, null)) !== 0) return
  await gitAsync(entry.path, ['branch', '-d', branch])
}
