import { useCallback, useState, useRef } from 'react'
import { DragEndEvent, DragStartEvent, DragOverEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'

interface UseBoardDnDProps {
  projectTasks: BoardTask[]
  sortedColumns: BoardColumn[]
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
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
  const moveTask = useBoardStore((s) => s.moveTask)
  const removeTask = useBoardStore((s) => s.removeTask)
  const updateTask = useBoardStore((s) => s.updateTask)
  const reorderColumns = useBoardStore((s) => s.reorderColumns)
  const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: BoardTask | BoardColumn } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const pendingMoveRef = useRef<{ id: string; columnId: string; orderIndex: number; name: string } | null>(null)
  const dragSnapshotRef = useRef<{ id: string; columnId?: string; orderIndex: number }[] | null>(null)

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
      if (task) {
        setActiveItem({ type: 'task', data: task })
        dragSnapshotRef.current = projectTasks.map(t => ({ id: t.id, columnId: t.columnId, orderIndex: t.orderIndex }))
      }
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
      pendingMoveRef.current = { id: activeId, columnId: overTask.columnId!, orderIndex: overTask.orderIndex, name: activeTask.name }
    } else if (overColumnId && activeTask.columnId !== overColumnId) {
      const tasksInColumn = projectTasks.filter((t) => t.columnId === overColumnId)
      moveTask(activeId, overColumnId, tasksInColumn.length)
      pendingMoveRef.current = { id: activeId, columnId: overColumnId, orderIndex: tasksInColumn.length, name: activeTask.name }
    }
  }, [projectTasks, sortedColumns, moveTask])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const activeType = active.data.current?.type

    const pendingMove = pendingMoveRef.current
    const snapshot = dragSnapshotRef.current
    pendingMoveRef.current = null
    dragSnapshotRef.current = null
    setActiveItem(null)
    setOverId(null)

    if (!over) {
      if (pendingMove) {
        const targetCol = sortedColumns.find((c) => c.id === pendingMove.columnId)
        const isDone = targetCol?.name.toLowerCase() === 'done'
        onTaskMove?.([{ id: pendingMove.id, orderIndex: pendingMove.orderIndex, columnId: pendingMove.columnId, name: pendingMove.name, ...(isDone && { status: 'done' }) }], snapshot ?? undefined)
      }
      return
    }

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
        if (pendingMove) {
          const targetCol = sortedColumns.find((c) => c.id === pendingMove.columnId)
          const isDone = targetCol?.name.toLowerCase() === 'done'
          const crossColUpdate = { id: pendingMove.id, orderIndex: pendingMove.orderIndex, columnId: pendingMove.columnId, name: pendingMove.name, ...(isDone && { status: 'done' as const }) }
          onTaskMove?.([crossColUpdate, ...moveUpdates], snapshot ?? undefined)
        } else if (moveUpdates.length > 0) {
          onTaskMove?.(moveUpdates, snapshot ?? undefined)
        }
        return
      }
    }

    if (pendingMove) {
      const targetCol = sortedColumns.find((c) => c.id === pendingMove.columnId)
      const isDone = targetCol?.name.toLowerCase() === 'done'
      onTaskMove?.([{ id: pendingMove.id, orderIndex: pendingMove.orderIndex, columnId: pendingMove.columnId, name: pendingMove.name, ...(isDone && { status: 'done' }) }], snapshot ?? undefined)
    }
  }, [projectTasks, sortedColumns, removeTask, updateTask, reorderColumns, onTaskMove, onTaskDelete, onColumnReorder])

  const handleDragCancel = useCallback(() => {
    const snapshot = dragSnapshotRef.current
    if (snapshot && pendingMoveRef.current) {
      for (const snap of snapshot) {
        if (snap.columnId) {
          moveTask(snap.id, snap.columnId, snap.orderIndex)
        }
      }
    }
    pendingMoveRef.current = null
    dragSnapshotRef.current = null
    setActiveItem(null)
    setOverId(null)
  }, [moveTask])

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
