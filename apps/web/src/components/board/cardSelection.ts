import type { BoardTask } from '@/lib/store/boardStore'

// Multi-select on the board. Pure — SortableTaskCard feeds it the click's
// modifier keys and the column's card order, TaskContextMenu asks it which
// cards a "Fuse N cards into this one" would absorb.

export interface SelectModifiers {
  /** Ctrl (Cmd on a Mac): toggle this card in the selection. */
  toggle: boolean
  /** Shift: select the run from the last-selected card in this column to this one. */
  range: boolean
}

export function selectModifiersFromEvent(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SelectModifiers | null {
  const toggle = e.ctrlKey || e.metaKey
  const range = e.shiftKey
  return toggle || range ? { toggle, range } : null
}

/**
 * The selection after a modified click. Selection order is kept — the first
 * card selected stays first — so a range extends rather than reorders.
 * Shift with no anchor in this column behaves like a plain add.
 */
export function nextSelection(
  current: readonly string[],
  clickedId: string,
  mods: SelectModifiers,
  columnOrder: readonly string[],
): string[] {
  if (mods.range) {
    const anchor = [...current].reverse().find((id) => id !== clickedId && columnOrder.includes(id))
    const clickedAt = columnOrder.indexOf(clickedId)
    if (anchor === undefined || clickedAt === -1) {
      return current.includes(clickedId) ? [...current] : [...current, clickedId]
    }
    const anchorAt = columnOrder.indexOf(anchor)
    const [lo, hi] = anchorAt < clickedAt ? [anchorAt, clickedAt] : [clickedAt, anchorAt]
    const run = columnOrder.slice(lo, hi + 1)
    return [...current, ...run.filter((id) => !current.includes(id))]
  }
  return current.includes(clickedId)
    ? current.filter((id) => id !== clickedId)
    : [...current, clickedId]
}

/**
 * The cards a fusion INTO `target` would absorb: every multi-selected card
 * that is still on the board, in the same project, and is not the target
 * itself, in selection order. ONLY the explicit multi-selection counts —
 * the keyboard's single `selectedTaskId` is set by merely opening a card,
 * and a destructive action must never be armed by incidental state.
 */
export function fuseSources(
  target: Pick<BoardTask, 'id' | 'projectId'>,
  selectedIds: readonly string[],
  tasks: readonly BoardTask[],
): BoardTask[] {
  const out: BoardTask[] = []
  for (const id of selectedIds) {
    if (id === target.id) continue
    const task = tasks.find((t) => t.id === id)
    if (task && task.projectId === target.projectId) out.push(task)
  }
  return out
}

/**
 * Click-away: an unmodified primary-button press outside every card, menu
 * and dialog drops the multi-selection, so "Fuse N cards" never stays armed
 * after the operator has moved on. Menus and dialogs live in portals, hence
 * the explicit markers.
 */
export function pointerDownClearsSelection(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: EventTarget | null }): boolean {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return false
  const target = e.target as Element | null
  if (!target || typeof target.closest !== 'function') return true
  return !target.closest('[data-task-id], [data-board-menu], [role="dialog"]')
}
