import { useCallback, useState } from 'react'
import { DragEndEvent, DragStartEvent, DragOverEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'

interface UseBoardDnDProps {
  projectTasks: BoardTask[]
  sortedColumns: BoardColumn[]
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]) => void
  onTaskDelete?: (taskId: string) => void
  onColumnReorder?: (updates: { id: string; orderIndex: number }[]) => void
}

export function useBoardDnD({
  projectTasks,
  sortedColumns,
  onTaskMove,
  onTaskDelete,
  onColumnReorder,
}: UseBoardDnDProps) {
  const { moveTask, removeTask, updateTask, reorderColumns } = useBoardStore()
  const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: BoardTask | BoardColumn } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const dragType = active.data.current?.type

    if (dragType === 'column') {
      const col = sortedColumns.find((c) => c.id === active.id)
      if (col) setActiveItem({ type: 'column', data: col })
    } else {
      const task = projectTasks.find((t) => t.id === active.id)
      if (task) setActiveItem({ type: 'task', data: task })
    }
  }, [projectTasks, sortedColumns])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) {
      setOverId(null)
      return
    }

    const activeType = active.data.current?.type
    const currentOverId = over.id as string
    setOverId(currentOverId)

    if (activeType === 'column') return

    const activeId = active.id as string
    const activeTask = projectTasks.find((t) => t.id === activeId)
    if (!activeTask) return

    const overTask = projectTasks.find((t) => t.id === currentOverId)
    const overColumnId = over.data.current?.columnId || (sortedColumns.find((c) => c.id === currentOverId)?.id)

    if (overTask && activeTask.columnId !== overTask.columnId) {
      moveTask(activeId, overTask.columnId!, overTask.orderIndex)
      onTaskMove?.([{ id: activeId, orderIndex: overTask.orderIndex, columnId: overTask.columnId, name: activeTask.name }])
    } else if (overColumnId && activeTask.columnId !== overColumnId) {
      const tasksInColumn = projectTasks.filter((t) => t.columnId === overColumnId)
      moveTask(activeId, overColumnId, tasksInColumn.length)
      onTaskMove?.([{ id: activeId, orderIndex: tasksInColumn.length, columnId: overColumnId, name: activeTask.name }])
    }
  }, [projectTasks, sortedColumns, moveTask, onTaskMove])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const activeType = active.data.current?.type

    setActiveItem(null)
    setOverId(null)

    if (!over) return

    if (activeType === 'column') {
      const activeId = active.id as string
      const overId = over.id as string
      if (activeId === overId) return

      const oldIndex = sortedColumns.findIndex((c) => c.id === activeId)
      const newIndex = sortedColumns.findIndex((c) => c.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(sortedColumns, oldIndex, newIndex)
      const updates = reordered.map((col, idx) => ({ id: col.id, orderIndex: idx }))
      reorderColumns(updates)
      onColumnReorder?.(updates)
      return
    }

    const activeId = active.id as string
    const overIdVal = over.id as string

    if (overIdVal === 'trash') {
      removeTask(activeId)
      onTaskDelete?.(activeId)
      return
    }

    const activeTask = projectTasks.find((t) => t.id === activeId)
    const overTask = projectTasks.find((t) => t.id === overIdVal)

    if (activeTask && overTask && activeTask.columnId === overTask.columnId && activeId !== overIdVal) {
      const columnTasks = projectTasks
        .filter((t) => t.columnId === activeTask.columnId)
        .sort((a, b) => a.orderIndex - b.orderIndex)

      const oldIndex = columnTasks.findIndex((t) => t.id === activeId)
      const newIndex = columnTasks.findIndex((t) => t.id === overIdVal)

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(columnTasks, oldIndex, newIndex)
        const moveUpdates: { id: string; orderIndex: number }[] = []
        reordered.forEach((task, index) => {
          if (task.orderIndex !== index) {
            updateTask(task.id, { orderIndex: index })
            moveUpdates.push({ id: task.id, orderIndex: index })
          }
        })
        if (moveUpdates.length > 0) onTaskMove?.(moveUpdates)
      }
    }
  }, [projectTasks, sortedColumns, removeTask, updateTask, reorderColumns, onTaskMove, onTaskDelete, onColumnReorder])

  const handleDragCancel = useCallback(() => {
    setActiveItem(null)
    setOverId(null)
  }, [])

  return {
    sensors,
    activeItem,
    overId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  }
}
