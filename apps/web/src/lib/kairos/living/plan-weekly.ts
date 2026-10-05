import type { DominionRow } from '@/lib/data/dominion-focus'
import { loadFocusSeam } from './plan-focus'

// Weekly review roster. `dominions` is every live Dominion (the model may still
// name any of them); `plan` is whose objectives count as the plan; `quiet` names
// the dormant ones the review must not judge as stalled.

type RosterRow = Pick<DominionRow, 'id' | 'name' | 'archivedAt' | 'focusState' | 'pinned' | 'activityScore' | 'sortOrder'>
type NamedDominion = { id: string; name: string }

export interface WeeklyRoster {
  dominions: NamedDominion[]
  plan: NamedDominion[]
  quiet: string[]
}

export const NO_WEEKLY_ROSTER: WeeklyRoster = { dominions: [], plan: [], quiet: [] }

const named = (d: NamedDominion): NamedDominion => ({ id: d.id, name: d.name })

export async function weeklyFocusRoster(rows: readonly RosterRow[]): Promise<WeeklyRoster> {
  const live = rows.filter((d) => !d.archivedAt)
  const seam = await loadFocusSeam()
  if (!seam) {
    const dominions = live.map(named)
    return { dominions, plan: dominions, quiet: [] }
  }
  const ranked = seam.rankByActivity(live)
  return {
    dominions: ranked.map(named),
    plan: ranked.filter((d) => !seam.isDormant(d)).map(named),
    quiet: ranked.filter((d) => seam.isDormant(d)).map((d) => d.name),
  }
}
