// dnd-kit auto-scrolls EVERY scrollable ancestor of the dragged card as the
// pointer nears its edges — the column, the board, and the window. The
// window must never be one of them: on a phone the document can be a few px
// wider than the viewport (a toolbar that overflows), and a drag towards the
// right edge then scrolls the whole page sideways — the board slides half
// off-screen and a second scrollbar appears (owner, 0409). Drag-left never
// showed it because scrollX was already 0. Columns and the board still
// auto-scroll; only the document is refused.

export function canAutoScroll(element: Element): boolean {
  if (typeof document === 'undefined') return true
  return element !== document.scrollingElement && element !== document.documentElement && element !== document.body
}

export const boardAutoScroll = { canScroll: canAutoScroll } as const
