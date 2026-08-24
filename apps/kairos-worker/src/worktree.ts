// Mission worktree lifecycle — every mission runs in a disposable `git
// worktree`, so the operator's live checkout is never branch-switched and a
// dirty tree is irrelevant instead of fatal. Ported from the Archon recon
// (docs/investigations/20260821-archon-mining-flight-deck.md, lane 3):
//   - create: fetch base → `git worktree add --no-track -b <branch> origin/<base>`
//   - re-runs reuse an existing mission branch in a fresh worktree
//   - ownership verification before adopting an existing directory
//   - idempotent destroy: junctions first → worktree remove → rm → prune → verify
//   - NO cleanup-on-startup (Archon learned it kills sibling runners' missions)

import { cpSync, existsSync, mkdirSync, rmdirSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { RepoEntry } from './registry.js'

export interface GitResult { ok: boolean; stdout: string; stderr: string }

export function git(cwd: string, args: string[]): GitResult {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: (res.stderr ?? '') || (res.error ? res.error.message : ''),
  }
}

export function worktreeRoot(): string {
  return process.env.KAIROS_WORKTREE_ROOT ?? join(homedir(), '.aeon', 'worktrees')
}

// aeon/1d28f417 → aeon-1d28f417: one directory level per worktree, and the
// name survives as a Windows path component.
export function worktreeDirFor(entry: RepoEntry, branch: string): string {
  return join(worktreeRoot(), entry.slug, branch.replace(/[^A-Za-z0-9._-]+/g, '-'))
}

export type WorktreeResult = { ok: true; path: string } | { ok: false; error: string }

export function createWorktree(entry: RepoEntry, branch: string): WorktreeResult {
  const path = worktreeDirFor(entry, branch)

  // Ownership verification (Archon): an existing directory is never adopted or
  // cleaned — it means a concurrent mission on the same card, or debris a
  // human should look at. Path-exclusivity is the concurrency primitive.
  if (existsSync(path)) {
    const head = git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const detail = head.ok && head.stdout.trim() === branch
      ? 'another mission on this card may be live'
      : 'and it is not a worktree on this branch'
    return { ok: false, error: `worktree path ${path} already exists — ${detail}; mission refused` }
  }

  // Fetch is best-effort: a flaky network must not sink the mission.
  const fetched = git(entry.path, ['fetch', 'origin'])
  if (!fetched.ok) console.warn(`[worker/worktree] git fetch origin failed in ${entry.slug}: ${fetched.stderr.trim()}`)

  mkdirSync(dirname(path), { recursive: true })

  // A re-run reuses the existing mission branch; a first run branches from the
  // remote default, falling back to the local one on fetch-less hosts.
  let added: GitResult
  if (git(entry.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok) {
    added = git(entry.path, ['worktree', 'add', path, branch])
  } else {
    added = git(entry.path, ['worktree', 'add', '--no-track', '-b', branch, path, `origin/${entry.defaultBranch}`])
    if (!added.ok) added = git(entry.path, ['worktree', 'add', '-b', branch, path, entry.defaultBranch])
  }
  if (!added.ok) return { ok: false, error: `git worktree add failed for ${branch}: ${added.stderr.trim()}` }

  seedIgnored(entry, path)
  return { ok: true, path }
}

// A fresh worktree holds no git-ignored files, so tests inside it would die on
// a cold folder. Dependency dirs are junctioned (huge, read-mostly); env files
// are copied. Relative paths only — the registry is operator-owned, but a
// stray absolute or traversal entry must not reach outside the trees.
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

// Idempotent destroy. Junctions are removed by hand FIRST: no recursive
// delete — git's or ours — may ever reach through one into the live
// checkout's real dependency dirs.
export function removeWorktree(entry: RepoEntry, branch: string): void {
  const path = worktreeDirFor(entry, branch)
  if (existsSync(path)) {
    for (const rel of entry.link) {
      if (!safeRel(rel)) continue
      const at = join(path, rel)
      try { rmdirSync(at) } catch { /* absent, or a real dir git will handle */ }
    }
    const removed = git(entry.path, ['worktree', 'remove', '--force', path])
    if (!removed.ok) {
      try { rmSync(path, { recursive: true, force: true }) } catch (err) {
        console.warn(`[worker/worktree] rm ${path} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  git(entry.path, ['worktree', 'prune'])
  if (existsSync(path)) console.warn(`[worker/worktree] ${path} still present after removal — manual sweep needed`)
}

// Commits the mission added on top of the base it branched from.
export function branchAhead(entry: RepoEntry, branch: string): number {
  const remoteBase = `origin/${entry.defaultBranch}`
  const base = git(entry.path, ['rev-parse', '--verify', '--quiet', remoteBase]).ok ? remoteBase : entry.defaultBranch
  const res = git(entry.path, ['rev-list', '--count', `${base}..${branch}`])
  const n = Number(res.stdout.trim())
  return res.ok && Number.isFinite(n) ? n : 0
}

export function pushBranch(entry: RepoEntry, branch: string): GitResult {
  return git(entry.path, ['push', '-u', 'origin', branch])
}

// A mission that produced no commits leaves no branch litter behind. Never
// touches the default branch, and -d (not -D) refuses anything unmerged as a
// last line of defence.
export function deleteBranchIfEmpty(entry: RepoEntry, branch: string): void {
  if (branch === entry.defaultBranch) return
  if (branchAhead(entry, branch) !== 0) return
  git(entry.path, ['branch', '-d', branch])
}
