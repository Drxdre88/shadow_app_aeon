import { listActiveDominions, type IdeaDominion } from '@/lib/data/idea-inputs'
import { loadFocusSeam } from './plan-focus'

// Idea generation roster. When on: awake Dominions, most active first, so the
// objective cap fills from live areas. If every Dominion is dormant the night
// still runs on all of them (flagged, so atlas targeting skips their cells).

export type IdeaFocusDominion = IdeaDominion & { dormant?: true }

export async function listIdeaFocusDominions(userId: string): Promise<IdeaFocusDominion[]> {
  const seam = await loadFocusSeam()
  if (!seam) return listActiveDominions(userId)
  const awake = await seam.listFocusDominions(userId)
  if (awake.length > 0) return awake.map((d) => ({ id: d.id, name: d.name }))
  const all = await seam.listFocusDominions(userId, { includeDormant: true })
  return all.map((d) => (d.dormant ? { id: d.id, name: d.name, dormant: true } : { id: d.id, name: d.name }))
}
