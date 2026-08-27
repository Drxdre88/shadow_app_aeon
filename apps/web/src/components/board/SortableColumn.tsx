'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardColumn } from '@/lib/store/boardStore'

interface SortableColumnProps {
  column: BoardColumn
  /** True while this column is lifted out into Zen mode — the on-board copy
      stays in layout (the exit flight lands on its rect) but is invisible
      and inert. */
  zenHidden?: boolean
  children: (dragHandleProps: Record<string, unknown>) => React.ReactNode
}

export function SortableColumn({ column, zenHidden, children }: SortableColumnProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column', column },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : zenHidden ? 0 : 1,
    zIndex: isDragging ? 50 : 'auto' as any,
    pointerEvents: zenHidden ? ('none' as const) : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex-shrink-0">
      {children({ ...attributes, ...listeners })}
    </div>
  )
}
