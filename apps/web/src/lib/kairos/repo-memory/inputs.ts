import type { RepoSessionRow } from '@/lib/data/repo-memory'
import { REPO_LESSONS_MAX_REPOS, REPO_LESSONS_SESSIONS_PER_REPO } from './types'

export interface RepoSessionGroup {
  slug: string
  sessions: RepoSessionRow[]
}

// Busiest repos first (ties: most recent session), at most 6 repos with
// their 8 newest sessions each. Rows arrive newest first.
export function groupSessionsByRepo(rows: readonly RepoSessionRow[]): RepoSessionGroup[] {
  const groups = new Map<string, RepoSessionRow[]>()
  for (const row of rows) {
    const list = groups.get(row.repo) ?? []
    list.push(row)
    groups.set(row.repo, list)
  }
  const newest = (list: RepoSessionRow[]) => Math.max(...list.map((r) => r.createdAt.getTime()))
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.length - a.length || newest(b) - newest(a))
    .slice(0, REPO_LESSONS_MAX_REPOS)
    .map(([slug, list]) => ({
      slug,
      sessions: [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, REPO_LESSONS_SESSIONS_PER_REPO),
    }))
}
