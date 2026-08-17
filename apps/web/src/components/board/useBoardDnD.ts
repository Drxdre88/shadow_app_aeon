import { useCallback, useEffect, useState, useRef } from 'react'
import { DragEndEvent, DragStartEvent, DragOverEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { nearestInsertionIndex, reorderWithInsertion, readCardRects } from './dropIndex'

type MoveUpdate = { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }

interface UseBoardDnDProps {
  projectTasks: BoardTask[]
  sortedColumns: BoardColumn[]
  onTaskMove?: (updates: MoveUpdate[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
  onTaskDelete?: (taskId: string) => void
  onColumnReorder?: (updates: { id: string; orderIndex: number }[]) => void
}

// Fallback when no pointer has been observed (keyboard drags): the activator
// position plus the accumulated delta, then the centre of the dragged card.
function pointerYFromEvent(event: DragEndEvent | DragOverEvent): number | null {
  const activator = event.activatorEvent as { clientY?: number } | undefined
  if (activator && typeof activator.clientY === 'number') return activator.clientY + event.delta.y
  const translated = event.active.rect.current.translated
  if (translated) return translated.top + translated.height / 2
  return null
}

function resolveTargetColumnId(overId: string, columns: BoardColumn[]): string | null {
  if (columns.some((c) => c.id === overId)) return overId
  const task = useBoardStore.getState().tasks.find((t) => t.id === overId)
  return task?.columnId ?? null
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
  const reorderColumns = useBoardStore((s) => s.reorderColumns)
  const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: BoardTask | BoardColumn } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const pendingMoveRef = useRef<{ id: string; columnId: string; orderIndex: number; name: string } | null>(null)
  const dragSnapshotRef = useRef<{ id: string; columnId?: string; orderIndex: number }[] | null>(null)
  const pointerYRef = useRef<number | null>(null)

  // The live pointer beats activator+delta: auto-scrolling a column inflates
  // the delta while the card rects move the other way, which would bias the
  // computed drop index.
  useEffect(() => {
    if (!activeItem) return
    const onPointerMove = (e: PointerEvent) => { pointerYRef.current = e.clientY }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [activeItem])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const dragType = active.data.current?.type
    pointerYRef.current = null

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

  // Final placement is always derived from the pointer against the target
  // column's live card rects, so releasing between two cards — or anywhere in
  // the column's empty space — snaps to the nearest gap instead of bouncing.
  const computePlacement = useCallback((
    activeTask: BoardTask,
    targetColumnId: string,
    pointerY: number | null,
  ): MoveUpdate[] => {
    const tasks = useBoardStore.getState().tasks
    const columnTasks = tasks
      .filter((t) => t.columnId === targetColumnId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
    const orderedIds = columnTasks.map((t) => t.id)

    const rects = readCardRects(targetColumnId, activeTask.id)
    const fallbackIndex = orderedIds.indexOf(activeTask.id)
    const index = pointerY === null
      ? (fallbackIndex === -1 ? orderedIds.length : fallbackIndex)
      : nearestInsertionIndex(pointerY, rects)

    const finalIds = reorderWithInsertion(orderedIds, activeTask.id, index)
    const isDone = sortedColumns.find((c) => c.id === targetColumnId)?.name.toLowerCase() === 'done'
    const byId = new Map(columnTasks.map((t) => [t.id, t]))

    const updates: MoveUpdate[] = []
    finalIds.forEach((id, orderIndex) => {
      if (id === activeTask.id) {
        updates.push({
          id,
          orderIndex,
          columnId: targetColumnId,
          name: activeTask.name,
          ...(isDone && { status: 'done' }),
        })
        return
      }
      const sibling = byId.get(id)
      if (!sibling || sibling.orderIndex === orderIndex) return
      updates.push({ id, orderIndex })
    })
    return updates
  }, [sortedColumns])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const activeType = active.data.current?.type

    const pendingMove = pendingMoveRef.current
    const snapshot = dragSnapshotRef.current
    pendingMoveRef.current = null
    dragSnapshotRef.current = null
    setActiveItem(null)
    setOverId(null)

    if (activeType === 'column') {
      const activeId = active.id as string
      const overColumnId = over?.id as string | undefined
      if (!overColumnId || activeId === overColumnId) return

      const oldIndex = sortedColumns.findIndex((c) => c.id === activeId)
      const newIndex = sortedColumns.findIndex((c) => c.id === overColumnId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(sortedColumns, oldIndex, newIndex)
      const updates = reordered.map((col, idx) => ({ id: col.id, orderIndex: idx }))
      reorderColumns(updates)
      onColumnReorder?.(updates)
      return
    }

    const activeId = active.id as string

    if (over?.id === 'trash') {
      removeTask(activeId)
      onTaskDelete?.(activeId)
      return
    }

    const activeTask = useBoardStore.getState().tasks.find((t) => t.id === activeId)
    if (!activeTask) return

    const targetColumnId = over ? resolveTargetColumnId(over.id as string, sortedColumns) : null

    if (!targetColumnId) {
      if (pendingMove) {
        const isDone = sortedColumns.find((c) => c.id === pendingMove.columnId)?.name.toLowerCase() === 'done'
        onTaskMove?.([{ id: pendingMove.id, orderIndex: pendingMove.orderIndex, columnId: pendingMove.columnId, name: pendingMove.name, ...(isDone && { status: 'done' }) }], snapshot ?? undefined)
      }
      return
    }

    const updates = computePlacement(activeTask, targetColumnId, pointerYRef.current ?? pointerYFromEvent(event))

    const { moveTask: storeMove, updateTask: storeUpdate } = useBoardStore.getState()
    for (const update of updates) {
      if (update.columnId) storeMove(update.id, update.columnId, update.orderIndex)
      else storeUpdate(update.id, { orderIndex: update.orderIndex })
    }

    const original = snapshot?.find((s) => s.id === activeId)
    const isNoOp = updates.length === 1
      && original?.columnId === targetColumnId
      && original.orderIndex === updates[0].orderIndex
    if (isNoOp) return

    onTaskMove?.(updates, snapshot ?? undefined)
  }, [sortedColumns, removeTask, reorderColumns, computePlacement, onTaskMove, onTaskDelete, onColumnReorder])

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
