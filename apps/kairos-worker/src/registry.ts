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
    out[slug] = {
      slug,
      path,
      defaultBranch: entry.defaultBranch ?? 'main',
      envSetupCmd: entry.envSetupCmd ?? null,
    }
  }
  return out
}

// Re-read on every claim so registry edits land without a worker restart.
export function resolveRepo(slug: string | null | undefined): RepoEntry | null {
  if (!slug) return null
  const repos = loadRepos()
  return repos[slug] ?? null
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
