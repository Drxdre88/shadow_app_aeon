import type { DragEndEvent, DragMoveEvent, DragOverEvent } from '@dnd-kit/core'
import { nearestInsertionIndex, type CardRect } from '../dropIndex'
import { resolveDropGroup } from './reorder'
import type { ChecklistItem } from './types'

/** Where a dragged item would land: `index` counts the target group's items
 *  WITHOUT the dragged one, so 0..siblings.length. */
export interface DropPlacement {
  groupName: string
  index: number
}

type ChecklistDragEvent = DragMoveEvent | DragOverEvent | DragEndEvent

// The pointer's row: the activating pointer plus the drag's accumulated
// delta. Keyboard drags have no pointer, so fall back to the dragged row's
// centre as dnd-kit translates it.
export function pointerYFromEvent(event: ChecklistDragEvent): number | null {
  const activator = event.activatorEvent as { clientY?: unknown } | null
  if (activator && typeof activator.clientY === 'number') return activator.clientY + event.delta.y
  const rect = event.active.rect.current.translated
  return rect ? rect.top + rect.height / 2 : null
}

// null = the group has no rendered rows (collapsed, empty, or not mounted).
export function readItemRects(groupName: string, excludeId: string): CardRect[] | null {
  if (typeof document === 'undefined') return null
  const group = document.querySelector(`[data-checklist-group="${CSS.escape(groupName)}"]`)
  if (!group) return null
  const rects: CardRect[] = []
  for (const el of group.querySelectorAll('[data-checklist-item-id]')) {
    const id = el.getAttribute('data-checklist-item-id')
    if (!id || id === excludeId) continue
    const box = el.getBoundingClientRect()
    if (box.height === 0) continue
    rects.push({ id, top: box.top, height: box.height })
  }
  return rects.length === 0 ? null : rects
}

/**
 * Resolve the drop target for an item drag from the pointer, not from which
 * row the collision picked: `over` only names the group (an item's group or
 * the group area itself); the slot inside it is the gap nearest the pointer,
 * the same rule the board uses for cards. A group with no rendered rows
 * (empty or collapsed) appends.
 */
export function placementForDrag(
  items: ChecklistItem[],
  displayGroups: string[],
  event: ChecklistDragEvent,
): DropPlacement | null {
  const { active, over } = event
  if (!over || active.data.current?.type !== 'item') return null
  const activeId = String(active.id)
  const groupName = resolveDropGroup(items, displayGroups, String(over.id))
  if (!groupName) return null
  const siblings = items.filter((i) => i.groupName === groupName && i.id !== activeId)
  const rects = readItemRects(groupName, activeId)
  const pointerY = pointerYFromEvent(event)
  if (!rects || pointerY === null) return { groupName, index: siblings.length }
  return { groupName, index: Math.min(nearestInsertionIndex(pointerY, rects), siblings.length) }
}

export function samePlacement(a: DropPlacement | null, b: DropPlacement | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.groupName === b.groupName && a.index === b.index
}
