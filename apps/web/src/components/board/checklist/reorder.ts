import { arrayMove } from '@dnd-kit/sortable'
import type { ChecklistItem } from './types'

/** The on-screen order of all items: grouped by display order, items already
 *  arrive globally sorted by orderIndex. */
export function visualItems(items: ChecklistItem[], displayGroups: string[]): ChecklistItem[] {
  return displayGroups.flatMap((g) => items.filter((i) => i.groupName === g))
}

/** Resolve which group a drop target belongs to. `overId` is either an item id
 *  (→ that item's group) or a group name (→ dropped onto the group itself). */
export function resolveDropGroup(
  items: ChecklistItem[],
  displayGroups: string[],
  overId: string,
): string | null {
  const overItem = items.find((i) => i.id === overId)
  if (overItem) return overItem.groupName
  if (displayGroups.includes(overId)) return overId
  return null
}

/**
 * Compute the full new arrangement for an item drag, as an ordered list of
 * `{ id, groupName }`. Intra-group moves use arrayMove to preserve the prior
 * feel; cross-group moves re-tag the item and insert it before the item it
 * landed on (or at the group's end when dropped on the group area itself).
 * Returns null for no-ops / unresolvable drops.
 */
export function arrangeItemDrag(
  items: ChecklistItem[],
  displayGroups: string[],
  activeId: string,
  overId: string,
): { id: string; groupName: string }[] | null {
  const active = items.find((i) => i.id === activeId)
  if (!active) return null
  const targetGroup = resolveDropGroup(items, displayGroups, overId)
  if (!targetGroup) return null

  if (targetGroup === active.groupName) {
    if (activeId === overId) return null
    const groupItems = items.filter((i) => i.groupName === targetGroup)
    const oldIndex = groupItems.findIndex((i) => i.id === activeId)
    const newIndex = groupItems.findIndex((i) => i.id === overId)
    if (oldIndex === -1 || newIndex === -1) return null
    const reordered = arrayMove(groupItems, oldIndex, newIndex)
    const full = displayGroups.flatMap((g) =>
      g === targetGroup ? reordered : items.filter((i) => i.groupName === g),
    )
    return full.map((i) => ({ id: i.id, groupName: i.groupName }))
  }

  const without = visualItems(items, displayGroups).filter((i) => i.id !== activeId)
  const overItem = items.find((i) => i.id === overId)
  let insertAt: number
  if (overItem) {
    insertAt = without.findIndex((i) => i.id === overId)
    if (insertAt === -1) insertAt = without.length
  } else {
    const lastOfGroup = without.map((i) => i.groupName).lastIndexOf(targetGroup)
    insertAt = lastOfGroup === -1 ? without.length : lastOfGroup + 1
  }
  without.splice(insertAt, 0, { ...active, groupName: targetGroup })
  // Re-group by on-screen order so blocks stay contiguous and an empty target
  // group keeps its slot (dropping into it must not shunt it to the bottom).
  const regrouped = displayGroups.flatMap((g) => without.filter((i) => i.groupName === g))
  return regrouped.map((i) => ({ id: i.id, groupName: i.groupName }))
}

/**
 * Arrangement after dropping `activeId` into `targetGroup` at `index`, where
 * `index` counts the group's items without the dragged one (0 = first,
 * siblings.length = last). Null when nothing would change.
 */
export function arrangeItemAt(
  items: ChecklistItem[],
  displayGroups: string[],
  activeId: string,
  targetGroup: string,
  index: number,
): { id: string; groupName: string }[] | null {
  const active = items.find((i) => i.id === activeId)
  if (!active || !displayGroups.includes(targetGroup)) return null
  const before = visualItems(items, displayGroups)
  const without = before.filter((i) => i.id !== activeId)
  const siblings = without.filter((i) => i.groupName === targetGroup)
  const clamped = Math.min(Math.max(index, 0), siblings.length)
  const moved = { ...active, groupName: targetGroup }
  if (clamped < siblings.length) without.splice(without.indexOf(siblings[clamped]), 0, moved)
  else if (siblings.length > 0) without.splice(without.indexOf(siblings[siblings.length - 1]) + 1, 0, moved)
  else without.push(moved)
  // Re-group by on-screen order so blocks stay contiguous and an empty target
  // group keeps its slot.
  const regrouped = displayGroups.flatMap((g) => without.filter((i) => i.groupName === g))
  const unchanged = regrouped.every((i, k) => i.id === before[k].id && i.groupName === before[k].groupName)
  if (unchanged) return null
  return regrouped.map((i) => ({ id: i.id, groupName: i.groupName }))
}
