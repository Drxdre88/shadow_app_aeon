import type { dominions } from '@/lib/db/schema'
import { livingDominionsMode } from './flag'

// Pure Living Dominions helpers (no database import), so consumers and tests
// can use them without loading the db client. Re-exported by lib/data/dominion-focus.

type Row = typeof dominions.$inferSelect

export function focusRankingOn(): boolean {
  return livingDominionsMode() === 'on'
}

export function isDormant(d: Pick<Row, 'focusState' | 'pinned'>): boolean {
  return d.focusState === 'dormant' && !d.pinned
}

export function rankByActivity<T extends Pick<Row, 'activityScore' | 'sortOrder' | 'name'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) =>
    (b.activityScore ?? 0) - (a.activityScore ?? 0) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

// True when the switch is on and this Dominion is dormant (consumers skip it).
export function skipForFocus(d: Pick<Row, 'focusState' | 'pinned'>): boolean {
  return focusRankingOn() && isDormant(d)
}
