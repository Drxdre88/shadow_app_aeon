import { livingDominionsMode } from './flag'

type FocusFields = { focusState: string; pinned: boolean }

// Drops dormant Dominions only when Living Dominions is on. The seam is loaded
// lazily so callers whose modules stay DB-free when off keep that property.
export async function dropDormantWhenOn<T extends FocusFields>(rows: T[]): Promise<T[]> {
  if (livingDominionsMode() !== 'on') return rows
  const { skipForFocus } = await import('@/lib/data/dominion-focus')
  return rows.filter((d) => !skipForFocus(d))
}
