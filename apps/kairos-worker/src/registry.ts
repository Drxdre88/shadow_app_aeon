// Host-local repo registry for poll mode. Aeon holds the logical repo config
// (hangar_repos table); disk paths are machine-specific and stay here, so the
// same board works from any runner host.
//
// File: apps/kairos-worker/repos.local.yaml (override with KAIROS_REPOS_FILE)
//
//   repos:
//     aeon:
//       path: C:/Users/you/dev/shadow_app_aeon
//       defaultBranch: main
//       envSetupCmd: null
//
// Parsed by the narrow reader below rather than a YAML dependency: the shape
// is exactly two levels of plain scalars and the worker has no runtime deps
// beyond tsx. A .json file at the same path is parsed as JSON instead.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export interface RepoEntry {
  slug: string
  path: string
  defaultBranch: string
  envSetupCmd: string | null
  // Git-ignored content seeded into mission worktrees: `link` dirs become
  // junctions (node_modules), `copy` files are copied (.env.local). Comma-
  // separated in the yaml — the narrow parser only does scalars.
  link: string[]
  copy: string[]
}

// The slug is a registry KEY that becomes both an object property and a
// filesystem path component. '__proto__' would poison the lookup object and
// '..' would climb out of the worktree root, so an unsafe key never becomes a
// RepoEntry in the first place.
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function safeSlug(slug: string): boolean {
  return SAFE_SLUG.test(slug)
}

function csv(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function reposFilePath(): string {
  return process.env.KAIROS_REPOS_FILE ?? join(WORKER_DIR, 'repos.local.yaml')
}

// Only a whitespace-preceded ` #` opens a comment, so Windows paths and urls
// that embed a hash survive — and the scan finds the first such marker rather
// than giving up on the first '#' in the line.
function stripComment(line: string): string {
  if (line.startsWith('#')) return ''
  const marker = /\s#/.exec(line)
  return marker ? line.slice(0, marker.index) : line
}

function scalar(raw: string): string | null {
  const value = raw.trim().replace(/^['"]|['"]$/g, '').trim()
  if (!value || value === 'null' || value === '~') return null
  return value
}

function parseReposYaml(text: string): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {}
  let inRepos = false
  let slugIndent = -1
  let current: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine)
    if (!line.trim()) continue

    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()

    if (indent === 0) {
      inRepos = /^repos:\s*$/.test(trimmed)
      slugIndent = -1
      current = null
      continue
    }
    if (!inRepos) continue

    const match = /^([A-Za-z0-9_.\-]+)\s*:\s*(.*)$/.exec(trimmed)
    if (!match) continue
    const [, key, value] = match

    if (slugIndent === -1 || indent <= slugIndent) {
      slugIndent = indent
      current = key
      out[key] = {}
      continue
    }
    if (current) out[current][key] = scalar(value)
  }

  return out
}

export function loadRepos(): Record<string, RepoEntry> {
  const file = reposFilePath()
  if (!existsSync(file)) return {}

  const text = readFileSync(file, 'utf8')
  const raw = file.endsWith('.json')
    ? (JSON.parse(text) as { repos?: Record<string, Record<string, string | null>> }).repos ?? {}
    : parseReposYaml(text)

  const out: Record<string, RepoEntry> = {}
  for (const [slug, entry] of Object.entries(raw)) {
    const path = entry?.path
    if (!path) continue
    if (!safeSlug(slug)) {
      console.warn(`[worker/registry] ignoring repo "${slug}" — a slug must be a plain path component ([A-Za-z0-9._-], no leading dot)`)
      continue
    }
    out[slug] = {
      slug,
      path,
      defaultBranch: entry.defaultBranch ?? 'main',
      envSetupCmd: entry.envSetupCmd ?? null,
      link: csv(entry.link),
      copy: csv(entry.copy),
    }
  }
  return out
}

// Re-read on every claim so registry edits land without a worker restart.
export function resolveRepo(slug: string | null | undefined): RepoEntry | null {
  if (!slug) return null
  const repos = loadRepos()
  // hasOwn, not a bare index: '__proto__' / 'constructor' would otherwise
  // resolve to an inherited value and be handed on as a RepoEntry.
  return Object.hasOwn(repos, slug) ? repos[slug] : null
}

// Stable across restarts so a reclaimed session can be traced to its host.
export function getWorkerId(): string {
  const file = join(dirname(reposFilePath()), '.worker-id')
  let suffix: string | null = null
  try {
    if (existsSync(file)) suffix = readFileSync(file, 'utf8').trim() || null
    if (!suffix) {
      suffix = randomBytes(3).toString('hex')
      writeFileSync(file, `${suffix}\n`, 'utf8')
    }
  } catch (err) {
    console.error('[worker/registry] worker-id file unavailable, using ephemeral id', err)
    suffix = suffix ?? randomBytes(3).toString('hex')
  }
  return `${hostname()}-${suffix}`
}
