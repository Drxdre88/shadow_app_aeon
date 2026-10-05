import { normalizeRepoSlug } from './repo-slug'

// Where a board's or repo's work lands. Active dominion_members rows win and
// split the work by weight; without one a board falls back to its
// projects.dominion_id and a repo to its dominion_repos rows (split evenly).
// Only the user's live (non-archived) Dominions can receive work; anything
// else is unattributed.

export type BoardInfo = { id: string; name: string; dominionId: string | null }
export type MemberLink = { id: string; kind: string; ref: string; dominionId: string; weight: number }
export type RepoMapping = { dominionId: string; repoSlug: string }
export type Share = { dominionId: string; share: number }

export class Attribution {
  private readonly boardMembers = new Map<string, MemberLink[]>()
  private readonly repoMembers = new Map<string, MemberLink[]>()
  private readonly repoMappings = new Map<string, Set<string>>()

  constructor(
    private readonly liveDominionIds: ReadonlySet<string>,
    private readonly boards: ReadonlyMap<string, BoardInfo>,
    members: readonly MemberLink[],
    repoMappings: readonly RepoMapping[],
  ) {
    for (const m of members) {
      if (!liveDominionIds.has(m.dominionId) || !(m.weight > 0)) continue
      const key = m.kind === 'repo' ? normalizeRepoSlug(m.ref) : m.kind === 'board' ? m.ref : null
      if (!key) continue
      const bucket = m.kind === 'repo' ? this.repoMembers : this.boardMembers
      bucket.set(key, [...(bucket.get(key) ?? []), m])
    }
    for (const r of repoMappings) {
      const slug = normalizeRepoSlug(r.repoSlug)
      if (!slug || !liveDominionIds.has(r.dominionId)) continue
      const set = this.repoMappings.get(slug) ?? new Set<string>()
      set.add(r.dominionId)
      this.repoMappings.set(slug, set)
    }
  }

  boardShares(boardId: string): Share[] {
    const members = this.boardMembers.get(boardId)
    if (members) return weightedShares(members)
    const fallback = this.boards.get(boardId)?.dominionId
    return fallback && this.liveDominionIds.has(fallback) ? [{ dominionId: fallback, share: 1 }] : []
  }

  repoShares(slug: string): Share[] {
    const members = this.repoMembers.get(slug)
    if (members) return weightedShares(members)
    const mapped = [...(this.repoMappings.get(slug) ?? [])]
    return mapped.map((dominionId) => ({ dominionId, share: 1 / mapped.length }))
  }

  // Active member rows whose board/repo received a signal, for last_signal_at.
  membersFor(kind: 'board' | 'repo', key: string): readonly MemberLink[] {
    return (kind === 'board' ? this.boardMembers : this.repoMembers).get(key) ?? []
  }
}

function weightedShares(members: readonly MemberLink[]): Share[] {
  const byDominion = new Map<string, number>()
  for (const m of members) byDominion.set(m.dominionId, (byDominion.get(m.dominionId) ?? 0) + m.weight)
  const total = [...byDominion.values()].reduce((a, b) => a + b, 0)
  return [...byDominion].map(([dominionId, w]) => ({ dominionId, share: w / total }))
}
