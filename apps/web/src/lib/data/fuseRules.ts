// Card fusion merge rules. Pure — no db, no React — so the server-side
// transaction (lib/data/fuse.ts) and the client's optimistic preview
// (components/board/fuseClient.ts) apply the SAME rules and can never drift.

export type FusePriority = 'low' | 'medium' | 'high' | 'urgent'

const PRIORITY_RANK: Record<FusePriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 }

/** The validator's ceiling for `size` (createTaskSchema / updateTaskSchema). */
export const MAX_TASK_SIZE = 20

export const DESCRIPTION_SEPARATOR = '\n\n---\n\n'

/** A date as the schema stores it (Date) or as the client holds it (ISO). */
type DateLike = Date | string | null | undefined

export interface FusableFields {
  name: string
  description?: string | null
  priority: string
  startDate?: DateLike
  endDate?: DateLike
  onTimeline: boolean
  size?: number | null
  estimateMinutes?: number | null
}

export interface FusePatch<D extends DateLike = DateLike> {
  name: string
  description: string | null
  priority: FusePriority
  startDate: D
  endDate: D
  onTimeline: boolean
  size: number | null
  estimateMinutes: number | null
}

function rank(priority: string): number {
  return PRIORITY_RANK[priority as FusePriority] ?? PRIORITY_RANK.medium
}

export function maxPriority(a: string, b: string): FusePriority {
  const winner = rank(a) >= rank(b) ? a : b
  return (winner in PRIORITY_RANK ? winner : 'medium') as FusePriority
}

export function mergeDescriptions(survivor: string | null | undefined, source: string | null | undefined): string | null {
  const base = survivor?.trim() ? survivor : null
  const extra = source?.trim() ? source : null
  if (!extra) return base
  if (!base) return extra
  return `${base}${DESCRIPTION_SEPARATOR}${extra}`
}

function time(d: DateLike): number | null {
  if (d === null || d === undefined || d === '') return null
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? null : t
}

function pickDate<D extends DateLike>(a: D, b: D, prefer: 'earliest' | 'latest'): D | null {
  const ta = time(a)
  const tb = time(b)
  if (ta === null) return tb === null ? null : b
  if (tb === null) return a
  if (prefer === 'earliest') return ta <= tb ? a : b
  return ta >= tb ? a : b
}

export function earliestDate<D extends DateLike>(a: D, b: D): D | null {
  return pickDate(a, b, 'earliest')
}

export function latestDate<D extends DateLike>(a: D, b: D): D | null {
  return pickDate(a, b, 'latest')
}

/** Both set: sum, capped. One set: that one. Neither: null. */
export function sumCapped(a: number | null | undefined, b: number | null | undefined, cap?: number): number | null {
  const hasA = typeof a === 'number' && Number.isFinite(a)
  const hasB = typeof b === 'number' && Number.isFinite(b)
  if (!hasA && !hasB) return null
  if (!hasA) return b as number
  if (!hasB) return a as number
  const sum = (a as number) + (b as number)
  return cap === undefined ? sum : Math.min(sum, cap)
}

/** The survivor's new scalar fields. Colour, column, position, progress stay the survivor's. */
export function mergeTaskFields<T extends FusableFields>(survivor: T, source: T, name: string): FusePatch<T['startDate']> {
  return {
    name: name.trim(),
    description: mergeDescriptions(survivor.description, source.description),
    priority: maxPriority(survivor.priority, source.priority),
    startDate: earliestDate(survivor.startDate, source.startDate) as T['startDate'],
    endDate: latestDate(survivor.endDate, source.endDate) as T['startDate'],
    onTimeline: survivor.onTimeline || source.onTimeline,
    size: sumCapped(survivor.size, source.size, MAX_TASK_SIZE),
    estimateMinutes: sumCapped(survivor.estimateMinutes, source.estimateMinutes),
  }
}

/** Union preserving the survivor's order, then the source's additions. */
export function unionIds(survivor: readonly string[], source: readonly string[]): string[] {
  const out = [...survivor]
  const seen = new Set(survivor)
  for (const id of source) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export interface ChecklistOrderItem {
  id: string
  groupName: string
  orderIndex: number
}

/**
 * The survivor's checklist after absorbing the source's: the survivor's items
 * keep their order; each source group whose name already exists on the
 * survivor lands at the END of that group, every other source group is
 * appended after everything. Returns every item with a fresh contiguous
 * orderIndex — the flat order the checklist UI groups by name.
 */
export function mergeChecklistOrder(
  survivorItems: readonly ChecklistOrderItem[],
  sourceItems: readonly ChecklistOrderItem[],
): { id: string; orderIndex: number; groupName: string }[] {
  const byIndex = (a: ChecklistOrderItem, b: ChecklistOrderItem) => a.orderIndex - b.orderIndex
  const survivor = [...survivorItems].sort(byIndex)
  const source = [...sourceItems].sort(byIndex)
  const survivorGroups = new Set(survivor.map((i) => i.groupName))

  const merged: ChecklistOrderItem[] = []
  for (const item of survivor) {
    merged.push(item)
    const isLastOfGroup = !survivor.some((s) => s.groupName === item.groupName && s.orderIndex > item.orderIndex)
    if (!isLastOfGroup) continue
    for (const extra of source) {
      if (extra.groupName === item.groupName) merged.push(extra)
    }
  }
  for (const extra of source) {
    if (!survivorGroups.has(extra.groupName)) merged.push(extra)
  }
  return merged.map((item, orderIndex) => ({ id: item.id, orderIndex, groupName: item.groupName }))
}

export interface DependencyEdge {
  blockerTaskId: string
  blockedTaskId: string
}

/**
 * Every source edge re-pointed at the survivor, minus the ones that would
 * become self-references (an edge between the two cards) or duplicate an edge
 * the survivor already has. The source's own edges vanish with its row.
 */
export function repointDependencies(
  sourceEdges: readonly DependencyEdge[],
  survivorEdges: readonly DependencyEdge[],
  sourceId: string,
  survivorId: string,
): DependencyEdge[] {
  const key = (e: DependencyEdge) => `${e.blockerTaskId}->${e.blockedTaskId}`
  const seen = new Set(survivorEdges.map(key))
  const inserts: DependencyEdge[] = []
  for (const edge of sourceEdges) {
    const moved = {
      blockerTaskId: edge.blockerTaskId === sourceId ? survivorId : edge.blockerTaskId,
      blockedTaskId: edge.blockedTaskId === sourceId ? survivorId : edge.blockedTaskId,
    }
    if (moved.blockerTaskId === moved.blockedTaskId) continue
    const k = key(moved)
    if (seen.has(k)) continue
    seen.add(k)
    inserts.push(moved)
  }
  return inserts
}
