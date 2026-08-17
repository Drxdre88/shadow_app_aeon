export interface CardRect {
  id: string
  top: number
  height: number
}

// Index of the gap nearest the pointer: every card whose midpoint sits above
// the pointer pushes the insertion point down by one. Returns 0..rects.length,
// so releasing over a column's empty area below the last card appends.
export function nearestInsertionIndex(pointerY: number, rects: CardRect[]): number {
  const ordered = [...rects].sort((a, b) => a.top - b.top)
  let index = 0
  for (const rect of ordered) {
    if (pointerY > rect.top + rect.height / 2) index++
    else break
  }
  return index
}

// Final order of a column after dropping `movedId` into `index`, given the
// column's current order. The moved card may or may not already be in the list
// (cross-column drags preview it in), so it is always removed first.
export function reorderWithInsertion(orderedIds: string[], movedId: string, index: number): string[] {
  const without = orderedIds.filter((id) => id !== movedId)
  const clamped = Math.min(Math.max(index, 0), without.length)
  return [...without.slice(0, clamped), movedId, ...without.slice(clamped)]
}

export function readCardRects(columnId: string, excludeTaskId?: string): CardRect[] {
  if (typeof document === 'undefined') return []
  const column = document.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)
  if (!column) return []
  const rects: CardRect[] = []
  for (const el of column.querySelectorAll('[data-task-id]')) {
    const id = el.getAttribute('data-task-id')
    if (!id || id === excludeTaskId) continue
    const box = el.getBoundingClientRect()
    if (box.height === 0) continue
    rects.push({ id, top: box.top, height: box.height })
  }
  return rects
}
