import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'

// Archetype lenses for idea_generate (wave 3 lane C). Pure DB: live archetype
// theme rows of the given Dominions, spread round-robin across Dominions
// (newest first within each) so one busy Dominion can't fill every lens.

export const IDEA_LENSES_MAX = 4
const SCAN_LIMIT = 60

export interface ArchetypeLensRow {
  id: string
  dominionId: string | null
  title: string
  summary: string | null
}

export function spreadLenses(rows: readonly ArchetypeLensRow[], max: number): ArchetypeLensRow[] {
  const byDominion = new Map<string, ArchetypeLensRow[]>()
  for (const r of rows) {
    const k = r.dominionId ?? ''
    byDominion.set(k, [...(byDominion.get(k) ?? []), r])
  }
  const queues = [...byDominion.values()]
  const out: ArchetypeLensRow[] = []
  for (let depth = 0; out.length < max && queues.some((q) => q.length > depth); depth++) {
    for (const q of queues) if (q[depth] && out.length < max) out.push(q[depth])
  }
  return out
}

export async function listArchetypeLenses(userId: string, dominionIds: readonly string[], max = IDEA_LENSES_MAX): Promise<ArchetypeLensRow[]> {
  if (dominionIds.length === 0 || max <= 0) return []
  const rows = await db
    .select({ id: memories.id, dominionId: memories.dominionId, title: memories.title, summary: memories.summary })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.streamClass, 'archetype'),
      isNull(memories.archivedAt),
      inArray(memories.dominionId, [...dominionIds]),
    ))
    .orderBy(desc(memories.createdAt), desc(memories.id))
    .limit(SCAN_LIMIT)
  return spreadLenses(rows, max)
}
