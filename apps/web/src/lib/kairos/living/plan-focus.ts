import { sql, type SQL } from 'drizzle-orm'
import { dominionObjectives, dominions } from '@/lib/db/schema'
import { livingDominionsMode } from './flag'

// Living Dominions for the planners (weekly review, question of the day, ideas,
// readiness). Only 'on' changes anything; off and 'observe' keep the old reads.
// The seam is loaded lazily: it pulls in the DB client, which flag-off paths
// (and their DB-free tests) never need.

export type FocusSeam = typeof import('@/lib/data/dominion-focus')

export function planFocusOn(): boolean {
  return livingDominionsMode() === 'on'
}

export async function loadFocusSeam(): Promise<FocusSeam | null> {
  return planFocusOn() ? import('@/lib/data/dominion-focus') : null
}

// Objectives whose Dominion is live (not archived) and awake (not dormant unless pinned).
export function focusObjectiveFilter(): SQL | undefined {
  if (!planFocusOn()) return undefined
  return sql`exists (select 1 from ${dominions} where ${dominions.id} = ${dominionObjectives.dominionId} and ${dominions.archivedAt} is null and (${dominions.pinned} or ${dominions.focusState} <> 'dormant'))`
}
