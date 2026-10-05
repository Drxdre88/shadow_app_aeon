import { focusRankingOn, isDormant, rankByActivity } from '@/lib/data/dominion-focus'

// 06:00 area headlines under Living Dominions (research/vorath_0510/living_dominions.md §2 C).
// Off/observe: rows pass through untouched (newest cortex first). On: dormant
// Dominions drop out and areas are led by activity rank instead of cortex time.

export type AreaFocusRow = {
  dominion: string
  focusState: string
  pinned: boolean
  activityScore: number
  sortOrder: number
}

const RANKED_ROW_LIMIT = 200

// Ranking happens before the newest-per-Dominion cut, so read a wider window when on.
export function areaRowLimit(defaultLimit: number): number {
  return focusRankingOn() ? Math.max(defaultLimit, RANKED_ROW_LIMIT) : defaultLimit
}

// Stable: rows of one Dominion keep their newest-first cortex order.
export function orderAreaRows<T extends AreaFocusRow>(rows: T[]): T[] {
  if (!focusRankingOn()) return rows
  const live = rows.filter((r) => !isDormant(r)).map((r) => ({ row: r, name: r.dominion, activityScore: r.activityScore, sortOrder: r.sortOrder }))
  return rankByActivity(live).map((r) => r.row)
}
