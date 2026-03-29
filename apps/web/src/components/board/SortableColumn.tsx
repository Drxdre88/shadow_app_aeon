'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardColumn } from '@/lib/store/boardStore'

interface SortableColumnProps {
  column: BoardColumn
  children: (dragHandleProps: Record<string, unknown>) => React.ReactNode
}

export function SortableColumn({ column, children }: SortableColumnProps) {
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
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : 'auto' as any,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex-shrink-0">
      {children({ ...attributes, ...listeners })}
    </div>
  )
}
