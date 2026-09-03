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
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
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

// Timeout is mandatory: a fetch/push wedged on a credential prompt or dead
// TCP connection would otherwise own the repo lock forever and silently
// poison every later mission on that repo. Exported because the repo lock's
// own timeout has to be derived from it, not guessed.
export const GIT_TIMEOUT_MS = 120_000

export async function gitAsync(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: (e.stderr ?? '').trim() || e.message || 'git failed' }
  }
}

// Worktree admin ops (add / prune / branch bookkeeping) on one repo must not
// interleave: prune during a sibling's add window can unregister it. Simple
// promise-chain mutex — enough for one runner process; cross-process safety
// comes from one-runner-per-host topology plus prune's expiry window. The key
// is the resolved, case-folded path so two registry spellings of one checkout
// share a chain, and a raced timeout guarantees a wedged op can never own the
// chain forever.
const repoLocks = new Map<string, Promise<unknown>>()

// The timebox exists to stop a WEDGED op owning the chain forever — it must
// never fire on a slow-but-live one, because rejecting does not cancel the git
// child: the chain would advance while `worktree add` is still running and the
// next op's `worktree prune` would unregister it (warden round 3). So the
// budget has to clear the longest locked body. createLocked is that body:
// rev-parse + add(remote) + add(local fallback), the same three again on the
// stale-entry retry, two prunes and the HEAD read = 9 sequential git calls,
// each capped at GIT_TIMEOUT_MS, plus slack for the local fs work between them.
const MAX_LOCKED_GIT_CALLS = 9
export const LOCK_TIMEOUT_MS = MAX_LOCKED_GIT_CALLS * GIT_TIMEOUT_MS + 60_000

function lockKey(repoPath: string): string {
  const resolved = resolve(repoPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function timeboxed<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`repo-lock operation exceeded ${LOCK_TIMEOUT_MS}ms`)),
      LOCK_TIMEOUT_MS,
    )
    fn().then(
      (value) => { clearTimeout(timer); resolvePromise(value) },
      (err) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))) },
    )
  })
}

export async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(repoPath)
  const prev = repoLocks.get(key) ?? Promise.resolve()
  const run = (): Promise<T> => timeboxed(fn)
  const next = prev.then(run, run)
  repoLocks.set(key, next.then(() => undefined, () => undefined))
  return next
}

export function worktreeRoot(): string {
  return process.env.KAIROS_WORKTREE_ROOT ?? join(homedir(), '.aeon', 'worktrees')
}

// Mission branches live in one namespace and nothing else is ever checked out
// into a mission worktree: a card-supplied branch naming an operator branch
// (say feat/flight-deck) would otherwise be `worktree add`-ed, committed onto
// by the agent and PUSHED by teardown. The namespace is also what makes
// reusing a pre-existing local branch safe on a re-run.
export const MISSION_BRANCH_PREFIX = 'aeon/'

export function isMissionBranch(branch: string | null | undefined): boolean {
  if (!branch || !branch.startsWith(MISSION_BRANCH_PREFIX)) return false
  const rest = branch.slice(MISSION_BRANCH_PREFIX.length)
  return rest.length > 0 && !rest.startsWith('/') && !rest.split(/[\\/]/).includes('..')
}

// The registry slug lands in a filesystem path, so it is flattened the same
// way as the branch: separators cannot survive, the result never leads with a
// dot or a dash, and anything left without a single alphanumeric falls back to
// a digest. A key of '..' or 'a/../..' would otherwise place the mission tree
// outside the worktree root.
export function slugDir(slug: string): string {
  const flat = slug.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
  return /[A-Za-z0-9]/.test(flat) ? flat : `slug-${createHash('sha1').update(slug).digest('hex').slice(0, 8)}`
}

// aeon/1d28f417 → aeon-1d28f417-<6-char digest>: one directory level per
// worktree, valid as a Windows path component, and the digest keeps distinct
// branches that sanitize identically (aeon/x vs aeon-x) from colliding.
export function worktreeDirFor(entry: RepoEntry, branch: string): string {
  const digest = createHash('sha1').update(branch).digest('hex').slice(0, 6)
  const flat = branch.replace(/[^A-Za-z0-9._-]+/g, '-')
  return join(worktreeRoot(), slugDir(entry.slug), `${flat}-${digest}`)
}

export type WorktreeResult =
  | { ok: true; path: string; startSha: string }
  | { ok: false; error: string }

export async function createWorktree(entry: RepoEntry, branch: string): Promise<WorktreeResult> {
  // Before anything touches git: a branch outside the mission namespace is
  // refused outright, so an operator branch can never be checked out into a
  // mission worktree, committed onto, or pushed by teardown.
  if (!isMissionBranch(branch)) {
    return {
      ok: false,
      error: `branch "${branch}" is outside the ${MISSION_BRANCH_PREFIX} mission namespace — mission refused; `
        + `leave the branch blank to get the generated ${MISSION_BRANCH_PREFIX}<card> name`,
    }
  }

  // Fetch is best-effort and only touches remote refs — outside the lock so a
  // slow network does not serialize sibling mission starts on this repo.
  const fetched = await gitAsync(entry.path, ['fetch', 'origin'])
  if (!fetched.ok) console.warn(`[worker/worktree] git fetch origin failed in ${entry.slug}: ${fetched.stderr.trim()}`)

  return withRepoLock(entry.path, () => createLocked(entry, branch))
}

async function createLocked(entry: RepoEntry, branch: string): Promise<WorktreeResult> {
  // Re-checked inside the lock: createLocked is the only thing that hands a
  // branch to `worktree add`, so the invariant is asserted where it is used
  // and not only at the entry point.
  if (!isMissionBranch(branch)) {
    return { ok: false, error: `branch "${branch}" is outside the ${MISSION_BRANCH_PREFIX} mission namespace — mission refused` }
  }

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

  mkdirSync(dirname(path), { recursive: true })

  const addOnce = async (): Promise<GitResult> => {
    // A re-run reuses the existing mission branch — only ever an aeon/ one,
    // guaranteed by the namespace check above; a first run branches from the
    // remote default, falling back to the local one on fetch-less hosts.
    if ((await gitAsync(entry.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok) {
      return gitAsync(entry.path, ['worktree', 'add', path, branch])
    }
    const remote = await gitAsync(entry.path, ['worktree', 'add', '--no-track', '-b', branch, path, `origin/${entry.defaultBranch}`])
    return remote.ok ? remote : gitAsync(entry.path, ['worktree', 'add', '-b', branch, path, entry.defaultBranch])
  }

  let added = await addOnce()
  if (!added.ok && /already (checked out|registered|used by worktree)/i.test(added.stderr) && !existsSync(path)) {
    // Stale admin entry for a worktree we already deleted (prune keeps a
    // 10-minute expiry window) — clear it deterministically and retry once.
    await gitAsync(entry.path, ['worktree', 'prune'])
    added = await addOnce()
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
      ensureIgnored(path, rel)
    } catch (err) {
      console.warn(`[worker/worktree] copy ${rel} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// A copied env file is a live credential sitting in a tree the agent may
// `git add -A`, and teardown PUSHES a productive branch — so the copy is only
// safe if git ignores it. When the repo's own rules don't, the rule goes into
// info/exclude, which git resolves through the COMMON gitdir: verified on git
// 2.52 that a linked worktree's own `worktrees/<name>/info/exclude` is not
// read at all, so there is no worktree-scoped alternative. The write is
// therefore idempotent, logged, and only ever names the operator's own
// already-untracked env path — it can never mask their tracked work.
function ensureIgnored(worktreePath: string, rel: string): void {
  const posix = rel.replace(/\\/g, '/')
  if (git(worktreePath, ['check-ignore', '-q', posix]).ok) return

  const located = git(worktreePath, ['rev-parse', '--git-path', 'info/exclude'])
  if (!located.ok) {
    console.error(`[worker/worktree] ${posix} is NOT git-ignored and info/exclude could not be located: ${located.stderr.trim()}`)
    return
  }
  const file = resolve(worktreePath, located.stdout.trim())
  try {
    mkdirSync(dirname(file), { recursive: true })
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (existing.split(/\r?\n/).some((line) => line.trim() === `/${posix}`)) return
    appendFileSync(file, `${existing && !existing.endsWith('\n') ? '\n' : ''}/${posix}\n`, 'utf8')
    console.warn(`[worker/worktree] ${posix} was not git-ignored — added it to ${file} so a mission commit cannot publish it`)
  } catch (err) {
    console.error(`[worker/worktree] could not exclude ${posix} in ${file}: ${err instanceof Error ? err.message : String(err)}`)
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
// on disk, not what the runner seeded. Hand-rolled walk because Windows'
// recursive readdirSync DESCENDS through junctions (warden round 2, proven):
// links are recorded and never entered, so the scan cannot wander into the
// live checkout, cannot loop on a self-referential junction, and never walks
// a large linked tree on the event loop.
//
// ok:false is the load-bearing part (warden round 3): a directory that could
// not be read, or one whose realpath resolves outside the tree, means the scan
// does NOT know that subtree is link-free — and an unscanned subtree must
// never look the same as a clean one to a recursive delete.
export interface LinkScan {
  ok: boolean
  links: string[]
  unscanned: string[]
}

export function findLinks(root: string): LinkScan {
  const links: string[] = []
  const unscanned: string[] = []

  let bound: string
  try {
    bound = realpathSync(root)
  } catch (err) {
    console.error(`[worker/worktree] link scan could not resolve ${root}: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, links, unscanned: [root] }
  }

  const inside = (dir: string): boolean => {
    try {
      const real = realpathSync(dir)
      return real === bound || real.startsWith(bound + sep)
    } catch {
      return false
    }
  }

  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.error(`[worker/worktree] link scan could not read ${dir}: ${err instanceof Error ? err.message : String(err)}`)
      unscanned.push(dir)
      return
    }
    for (const d of entries) {
      const p = join(dir, d.name)
      if (d.isSymbolicLink()) {
        links.push(p) // record, NEVER descend
        continue
      }
      if (!d.isDirectory()) continue
      // Not flagged a symlink yet resolving elsewhere (a mount point, a
      // directory hardlink): unknown territory, never descended into.
      if (!inside(p)) {
        console.error(`[worker/worktree] link scan refuses to descend ${p} — it resolves outside ${bound}`)
        unscanned.push(p)
        continue
      }
      walk(p)
    }
  }

  walk(root)
  return { ok: unscanned.length === 0, links, unscanned }
}

export interface DestroyResult { removed: boolean; depsMutated: boolean; path: string }

export async function removeWorktree(entry: RepoEntry, branch: string): Promise<DestroyResult> {
  return withRepoLock(entry.path, () => destroyLocked(entry, branch))
}

async function destroyLocked(entry: RepoEntry, branch: string): Promise<DestroyResult> {
  const path = worktreeDirFor(entry, branch)
  let depsMutated = false

  sweepTrash(dirname(path))

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
    for (const link of findLinks(path).links) dropLink(link)

    // 3. Verify link-free, else refuse: no recursive delete — git's or ours —
    //    may run over a tree that still holds a reparse point, nor over one the
    //    scan could not read end to end. The tree is left for a manual sweep.
    const leftover = findLinks(path)
    if (!leftover.ok) {
      console.error(`[worker/worktree] ${path} could not be fully scanned (${leftover.unscanned[0]}) — refusing recursive delete, manual sweep needed`)
      return { removed: false, depsMutated, path }
    }
    if (leftover.links.length > 0) {
      console.error(`[worker/worktree] ${path} still holds a link (${leftover.links[0]}) — refusing recursive delete, manual sweep needed`)
      return { removed: false, depsMutated, path }
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
        console.warn(`[worker/worktree] could not fully remove ${path} (trash: ${trash}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Expiry window instead of bare prune: a second runner process (or a
  // restart overlapping shutdown) must not unregister a sibling's in-flight
  // add. Entries younger than the window are swept by a later teardown, or
  // deterministically by createLocked's stale-entry retry.
  await gitAsync(entry.path, ['worktree', 'prune', '--expire=10.minutes.ago'])
  return { removed: !existsSync(path), depsMutated, path }
}

// .trash-* dirs are rename-then-delete leftovers: provably link-free by
// construction (renamed only after the link scan came back clean), so a
// recursive delete is safe. Swept once they are a day old.
function sweepTrash(slugDir: string): void {
  try {
    for (const d of readdirSync(slugDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !/\.trash-\d{13,}$/.test(d.name)) continue
      const stamp = Number(d.name.slice(d.name.lastIndexOf('-') + 1))
      if (!Number.isFinite(stamp) || Date.now() - stamp < 24 * 60 * 60 * 1000) continue
      try {
        rmSync(join(slugDir, d.name), { recursive: true, force: true })
      } catch { /* still locked — next teardown retries */ }
    }
  } catch { /* slug dir absent — nothing to sweep */ }
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
  const del = await gitAsync(entry.path, ['branch', '-d', branch])
  if (!del.ok && /used by worktree|checked out/i.test(del.stderr) && !existsSync(worktreeDirFor(entry, branch))) {
    // The prune expiry window keeps the just-removed worktree's admin entry
    // for 10 minutes, and git counts that as "checked out". The directory is
    // verifiably gone and ours — but a bare prune is repo-wide, so it must
    // hold the repo lock or it could unregister a sibling's in-flight add.
    await withRepoLock(entry.path, async () => {
      await gitAsync(entry.path, ['worktree', 'prune'])
      await gitAsync(entry.path, ['branch', '-d', branch])
    })
  }
}
