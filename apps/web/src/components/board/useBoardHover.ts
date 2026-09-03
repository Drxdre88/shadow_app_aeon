import { useEffect, useRef, useState } from 'react'

/**
 * Tracks the card under the pointer for the single-key card shortcuts.
 *
 * The listener lives on the document, not the board element: Column Zen
 * mode renders its cards in a portal above the board, and a board-scoped
 * listener never saw them — the shortcuts then fired on whatever card was
 * last hovered on the board (or the selected one), so a label pressed over
 * a Zen card landed on a different card. Cards are the only elements that
 * carry data-task-id, so any hit is a real card wherever it is rendered.
 */
export function useBoardHover() {
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-task-id]')
      setHoveredTaskId(el?.getAttribute('data-task-id') ?? null)
    }
    // Leaving the window fires no mouseover, so the last card would stay
    // armed until the pointer came back.
    const onLeave = () => setHoveredTaskId(null)
    document.addEventListener('mouseover', onOver)
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return { boardRef, hoveredTaskId }
}
