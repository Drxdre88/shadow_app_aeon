import type { RepoSessionRow } from '@/lib/data/repo-memory'
import type { RepoGitDigest } from './git-digest'
import { REPO_LESSONS_DIGESTS_PER_REPO, REPO_LESSONS_MAX_REPOS, REPO_LESSONS_SESSIONS_PER_REPO } from './types'

export interface RepoSessionGroup {
  slug: string
  sessions: RepoSessionRow[]
}

export interface RepoActivityGroup extends RepoSessionGroup {
  digests: RepoGitDigest[]
}

function rankedSessionGroups(rows: readonly RepoSessionRow[]): RepoSessionGroup[] {
  const groups = new Map<string, RepoSessionRow[]>()
  for (const row of rows) {
    const list = groups.get(row.repo) ?? []
    list.push(row)
    groups.set(row.repo, list)
  }
  const newest = (list: RepoSessionRow[]) => Math.max(...list.map((r) => r.createdAt.getTime()))
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.length - a.length || newest(b) - newest(a))
    .map(([slug, list]) => ({
      slug,
      sessions: [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, REPO_LESSONS_SESSIONS_PER_REPO),
    }))
}

// Busiest repos first (ties: most recent session), at most 6 repos with
// their 8 newest sessions each. Rows arrive newest first.
export function groupSessionsByRepo(rows: readonly RepoSessionRow[]): RepoSessionGroup[] {
  return rankedSessionGroups(rows).slice(0, REPO_LESSONS_MAX_REPOS)
}

// Candidates for the nightly lessons job: every repo with an agent session or
// a git digest. Ranking: repos with sessions first, in the session order
// above; then git-only repos by commits that day (ties: newest day, then
// name). At most 6 repos; each keeps its 2 newest digests (one per day).
export function groupRepoActivity(rows: readonly RepoSessionRow[], digests: readonly RepoGitDigest[]): RepoActivityGroup[] {
  const bySlug = new Map<string, RepoGitDigest[]>()
  const seen = new Set<string>()
  for (const d of [...digests].sort((a, b) => b.day.localeCompare(a.day))) {
    const key = `${d.slug}:${d.day}`
    if (seen.has(key)) continue
    seen.add(key)
    bySlug.set(d.slug, [...(bySlug.get(d.slug) ?? []), d])
  }
  const digestsOf = (slug: string) => (bySlug.get(slug) ?? []).slice(0, REPO_LESSONS_DIGESTS_PER_REPO)
  const withSessions = rankedSessionGroups(rows).map((g) => ({ ...g, digests: digestsOf(g.slug) }))
  const sessionSlugs = new Set(withSessions.map((g) => g.slug))
  const commits = (list: RepoGitDigest[]) => list.reduce((n, d) => n + d.stats.commits, 0)
  const gitOnly = [...bySlug.keys()]
    .filter((slug) => !sessionSlugs.has(slug))
    .map((slug) => ({ slug, sessions: [] as RepoSessionRow[], digests: digestsOf(slug) }))
    .sort((a, b) => commits(b.digests) - commits(a.digests)
      || (b.digests[0]?.day ?? '').localeCompare(a.digests[0]?.day ?? '')
      || a.slug.localeCompare(b.slug))
  return [...withSessions, ...gitOnly].slice(0, REPO_LESSONS_MAX_REPOS)
}
