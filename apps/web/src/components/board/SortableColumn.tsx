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
    // flex flex-col: this wrapper is the flex item that stretches to the
    // lane's full height; the child droppable uses flex-1 to fill it, so a
    // drop below a short column's content-fit box still hits that column.
    <div ref={setNodeRef} style={style} className="flex-shrink-0 flex flex-col">
      {children({ ...attributes, ...listeners })}
    </div>
  )
}
