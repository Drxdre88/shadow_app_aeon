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

// Converts the pointer's gap among the VISIBLE cards into an insertion index
// in the column's full (unfiltered) order. The DOM only shows cards surviving
// the active filter/search, so a rect-count index must not be applied to the
// unfiltered list directly — instead anchor on the rect id the pointer lands
// before (or the last visible id when past the end).
export function insertionIndexInFullOrder(pointerY: number, rects: CardRect[], orderedIds: string[]): number {
  const ordered = [...rects].sort((a, b) => a.top - b.top)
  if (ordered.length === 0) return orderedIds.length
  const visIdx = nearestInsertionIndex(pointerY, ordered)
  if (visIdx < ordered.length) {
    const full = orderedIds.indexOf(ordered[visIdx].id)
    return full === -1 ? orderedIds.length : full
  }
  const full = orderedIds.indexOf(ordered[ordered.length - 1].id)
  return full === -1 ? orderedIds.length : full + 1
}

// Final order of a column after dropping `movedId` into `index`, given the
// column's current order. The moved card may or may not already be in the list
// (cross-column drags preview it in), so it is always removed first.
export function reorderWithInsertion(orderedIds: string[], movedId: string, index: number): string[] {
  const without = orderedIds.filter((id) => id !== movedId)
  const clamped = Math.min(Math.max(index, 0), without.length)
  return [...without.slice(0, clamped), movedId, ...without.slice(clamped)]
}

export interface MoveUpdate {
  id: string
  orderIndex: number
  status?: string
  columnId?: string
  name?: string
}

// Turns a column's final id order into the minimal set of persisted rows: the
// moved card always carries its destination column (and name/status the write
// path needs), every other card only appears if its index actually shifted.
// `currentOrder` is the column's pre-move truth — the FULL order, including
// cards a filter is hiding, so hidden rows keep contiguous indices.
export function buildMoveUpdates(
  finalIds: string[],
  currentOrder: Array<{ id: string; orderIndex: number }>,
  moved: { id: string; columnId: string; name?: string; status?: string },
): MoveUpdate[] {
  const byId = new Map(currentOrder.map((t) => [t.id, t]))
  const updates: MoveUpdate[] = []
  finalIds.forEach((id, orderIndex) => {
    if (id === moved.id) {
      updates.push({
        id,
        orderIndex,
        columnId: moved.columnId,
        name: moved.name,
        ...(moved.status ? { status: moved.status } : {}),
      })
      return
    }
    const sibling = byId.get(id)
    if (!sibling || sibling.orderIndex === orderIndex) return
    updates.push({ id, orderIndex })
  })
  return updates
}

// null = the column's DOM element wasn't found (collapsed/unmounted) — the
// caller must fall back rather than treat it as an empty column.
export function readCardRects(columnId: string, excludeTaskId?: string): CardRect[] | null {
  if (typeof document === 'undefined') return null
  const column = document.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)
  if (!column) return null
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

// While a drag is live the sortable strategy displaces cards with an inline
// translate. The SLOT rect is the layout box without that displacement —
// stable under the pointer even as the card itself slides out of the way.
// The translate is in the card's own px; scale it by rendered/layout height
// so a pinch-zoomed board (which scales the columns) still measures in
// viewport px.
export function inlineTranslateY(el: Element): number {
  const style = (el as HTMLElement).style
  const m = /translate3d\(\s*-?[\d.]+px,\s*(-?[\d.]+)px/.exec(style?.transform ?? '')
  if (!m) return 0
  const layoutHeight = (el as HTMLElement).offsetHeight
  const rendered = el.getBoundingClientRect().height
  const scale = layoutHeight > 0 && rendered > 0 ? rendered / layoutHeight : 1
  return Number(m[1]) * scale
}

export function readCardSlotRects(columnId: string, excludeTaskId?: string): CardRect[] | null {
  if (typeof document === 'undefined') return null
  const column = document.querySelector(`[data-column-id="${CSS.escape(columnId)}"]`)
  if (!column) return null
  const rects: CardRect[] = []
  for (const el of column.querySelectorAll('[data-task-id]')) {
    const id = el.getAttribute('data-task-id')
    if (!id || id === excludeTaskId) continue
    const box = el.getBoundingClientRect()
    if (box.height === 0) continue
    rects.push({ id, top: box.top - inlineTranslateY(el), height: box.height })
  }
  return rects
}

