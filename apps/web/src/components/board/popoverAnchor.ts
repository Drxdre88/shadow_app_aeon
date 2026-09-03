export interface AnchorPosition {
  top: number
  left: number
}

/**
 * The on-screen element for a card. While a column is in Zen mode its cards
 * exist twice: the board copy (kept in the DOM at opacity 0 so the column
 * flies back to a measurable rect) and the visible copy in the Zen portal.
 * The board copy comes first in document order, so a plain querySelector
 * anchors popovers and celebrations to the invisible card.
 */
export function findCardElement(taskId: string): Element | null {
  if (typeof document === 'undefined') return null
  const selector = `[data-task-id="${CSS.escape(taskId)}"]`
  return document.querySelector(`[data-zen-layer] ${selector}`) ?? document.querySelector(selector)
}

// Places a floating panel under the hovered card, flipping above it when there
// is no room below. Falls back to the viewport centre when the card is not on
// screen (e.g. the trigger came from an open modal).
export function anchorToCard(taskId: string, width: number, height: number): AnchorPosition {
  if (typeof document === 'undefined') return { top: 0, left: 0 }

  const rect = findCardElement(taskId)?.getBoundingClientRect()
  if (!rect || rect.width === 0) {
    return {
      top: Math.round(window.innerHeight / 2 - height / 2),
      left: Math.round(window.innerWidth / 2 - width / 2),
    }
  }

  const top = rect.bottom + 8 + height > window.innerHeight
    ? Math.max(8, rect.top - height - 8)
    : rect.bottom + 8
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
  return { top: Math.round(top), left: Math.round(left) }
}
