import type { DominionRow } from '@/lib/data/dominion-focus'
import { loadFocusSeam } from './plan-focus'

// Question of the day roster: when on, dormant Dominions are neither valid
// targets nor "you haven't reflected on X" staleness signals.

type AskRow = Pick<DominionRow, 'id' | 'archivedAt' | 'focusState' | 'pinned'>

export async function askFocusRoster<R extends { dominionId: string }>(
  all: readonly AskRow[],
  reflections: R[],
): Promise<{ validDominionIds: Set<string>; reflectionRows: R[] }> {
  const live = all.filter((d) => !d.archivedAt)
  const seam = await loadFocusSeam()
  if (!seam) return { validDominionIds: new Set(live.map((d) => d.id)), reflectionRows: reflections }
  const validDominionIds = new Set(live.filter((d) => !seam.isDormant(d)).map((d) => d.id))
  return { validDominionIds, reflectionRows: reflections.filter((r) => validDominionIds.has(r.dominionId)) }
}
