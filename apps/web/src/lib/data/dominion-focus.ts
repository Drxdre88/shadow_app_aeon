import { db } from '@/lib/db'
import { dominions } from '@/lib/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { focusRankingOn, isDormant, rankByActivity } from '@/lib/kairos/living/focus'

export { focusRankingOn, isDormant, rankByActivity, skipForFocus } from '@/lib/kairos/living/focus'

// Living Dominions seam (research/vorath_0510/living_dominions.md §2 C): the one
// Dominion roster every focus consumer reads. With KAIROS_LIVING_DOMINIONS off
// or 'observe' it returns exactly what consumers read before (non-archived, by
// sortOrder then name); with '1' it ranks by activity and drops dormant ones.

export type DominionRow = typeof dominions.$inferSelect

export type FocusDominion = DominionRow & { dormant: boolean }

async function liveRows(userId: string): Promise<DominionRow[]> {
  return db
    .select()
    .from(dominions)
    .where(and(eq(dominions.userId, userId), isNull(dominions.archivedAt)))
    .orderBy(asc(dominions.sortOrder), asc(dominions.name))
}

// Every non-archived Dominion with its dormant flag; ranked when the switch is on.
export async function listLiveDominions(userId: string): Promise<FocusDominion[]> {
  const rows = await liveRows(userId)
  const ordered = focusRankingOn() ? rankByActivity(rows) : rows
  return ordered.map((d) => ({ ...d, dormant: isDormant(d) }))
}

// The Dominions Vorath should pay attention to. Off/observe: all live ones in the
// old order. On: ranked by activity, dormant ones left out unless asked for.
export async function listFocusDominions(userId: string, opts: { includeDormant?: boolean } = {}): Promise<FocusDominion[]> {
  const rows = await listLiveDominions(userId)
  if (!focusRankingOn() || opts.includeDormant) return rows
  return rows.filter((d) => !d.dormant)
}

export async function setDominionPinned(id: string, userId: string, pinned: boolean): Promise<DominionRow | null> {
  const [row] = await db
    .update(dominions)
    .set(pinned ? { pinned, focusState: 'active', updatedAt: new Date() } : { pinned, updatedAt: new Date() })
    .where(and(eq(dominions.id, id), eq(dominions.userId, userId)))
    .returning()
  return row ?? null
}
