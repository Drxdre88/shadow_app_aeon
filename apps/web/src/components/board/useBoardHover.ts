import { useEffect, useRef, useState } from 'react'

export function useBoardHover() {
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-task-id]')
      setHoveredTaskId(el?.getAttribute('data-task-id') ?? null)
    }
    const onLeave = () => setHoveredTaskId(null)
    board.addEventListener('mouseover', onOver)
    board.addEventListener('mouseleave', onLeave)
    return () => {
      board.removeEventListener('mouseover', onOver)
      board.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return { boardRef, hoveredTaskId }
}
