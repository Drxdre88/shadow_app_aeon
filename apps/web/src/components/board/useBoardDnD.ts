import { useCallback, useEffect, useState, useRef } from 'react'
import { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { insertionIndexInFullOrder, reorderWithInsertion, readCardRects, buildMoveUpdates, type MoveUpdate } from './dropIndex'
import { useBoardSensors } from './useBoardSensors'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import { shouldAutoRunOnDrop } from './autoRun'
import { isHoldRelease, placementIndex, type PlacementTarget } from './useHoldToMove'

/** Auto AI: the move that should launch a mission ONCE it is persisted. */
export interface MoveLaunchIntent {
  autoRunTaskId: string
  /** When the drop happened — the intent expires if the move saves late. */
  armedAt: number
}

/** Pre-move positions of every card on the board — the undo baseline. */
export type MoveSnapshot = { id: string; columnId?: string; orderIndex: number }[]

interface UseBoardDnDProps {
  projectTasks: BoardTask[]
  sortedColumns: BoardColumn[]
  onTaskMove?: (
    updates: MoveUpdate[],
    snapshot?: MoveSnapshot,
    launch?: MoveLaunchIntent,
  ) => void

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

function snapshotOf(tasks: BoardTask[]): MoveSnapshot {
  return tasks.map((t) => ({ id: t.id, columnId: t.columnId, orderIndex: t.orderIndex }))
}

/** A column's cards in their FULL (unfiltered) order, straight from the store. */
function columnOrder(columnId: string) {
  const columnTasks = useBoardStore.getState().tasks
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  return { columnTasks, orderedIds: columnTasks.map((t) => t.id) }
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
  const dragSnapshotRef = useRef<MoveSnapshot | null>(null)
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

  const sensors = useBoardSensors()

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const dragType = active.data.current?.type
    pointerYRef.current = null
    // A real drag supersedes a pending hold-to-move placement.
    useBoardStore.getState().setMovingTaskId(null)

    if (dragType === 'column') {
      const col = sortedColumns.find((c) => c.id === active.id)
      if (col) setActiveItem({ type: 'column', data: col })
    } else {
      const task = projectTasks.find((t) => t.id === active.id)
      if (task) {
        setActiveItem({ type: 'task', data: task })
        dragSnapshotRef.current = snapshotOf(projectTasks)
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

  // Drop placement is always derived from the pointer against the target
  // column's live card rects, so releasing between two cards — or anywhere in
  // the column's empty space — snaps to the nearest gap instead of bouncing.
  const resolveDropIndex = useCallback((
    activeTask: BoardTask,
    targetColumnId: string,
    pointerY: number | null,
  ): number => {
    const { orderedIds } = columnOrder(targetColumnId)
    const rects = readCardRects(targetColumnId, activeTask.id)
    const fallbackIndex = orderedIds.indexOf(activeTask.id)
    // rects hold only the cards surviving the active filter/search — anchor
    // the pointer gap on rect ids, never apply a visible-count index to the
    // unfiltered order. rects === null means the column DOM wasn't found.
    return pointerY === null || rects === null
      ? (fallbackIndex === -1 ? orderedIds.length : fallbackIndex)
      : insertionIndexInFullOrder(pointerY, rects, orderedIds)
  }, [])

  // THE move commit. Every way a card lands in a slot — a drag-drop, a
  // hold-to-move placement, and (layered later) a fusion drop — ends here, so
  // store update, persistence, undo baseline, Done-status and Auto AI arming
  // can never diverge between gestures. `index` counts the target column's
  // OTHER cards (see reorderWithInsertion); `snapshot` is the pre-gesture
  // board, or null to snapshot the store as it stands right now.
  const commitMove = useCallback((
    activeTask: BoardTask,
    targetColumnId: string,
    index: number,
    snapshot: MoveSnapshot | null,
  ) => {
    const baseline = snapshot ?? snapshotOf(useBoardStore.getState().tasks.filter((t) => t.projectId === activeTask.projectId))
    const { columnTasks, orderedIds } = columnOrder(targetColumnId)
    const finalIds = reorderWithInsertion(orderedIds, activeTask.id, index)
    const isDone = sortedColumns.find((c) => c.id === targetColumnId)?.name.toLowerCase() === 'done'

    const updates = buildMoveUpdates(finalIds, columnTasks, {
      id: activeTask.id,
      columnId: targetColumnId,
      name: activeTask.name,
      ...(isDone && { status: 'done' }),
    })

    const { moveTask: storeMove, updateTask: storeUpdate } = useBoardStore.getState()
    for (const update of updates) {
      if (update.columnId) storeMove(update.id, update.columnId, update.orderIndex)
      else storeUpdate(update.id, { orderIndex: update.orderIndex })
    }

    const original = baseline.find((s) => s.id === activeTask.id)
    const isNoOp = updates.length === 1
      && original?.columnId === targetColumnId
      && original.orderIndex === updates[0].orderIndex
    if (isNoOp) return

    // Auto AI: the column move IS the launch commitment, but only for a card
    // the operator armed on THIS board. The launch is handed to the move
    // callback rather than fired here — the move is queued, not yet durable,
    // and a launch that outlives a rolled-back move puts an agent on a repo
    // for a card that never moved.
    const hangarState = useHangarUiStore.getState()
    // projectId match matters: the store is board-scoped, and a config left
    // over from another board must never arm drops on this one.
    const armed = hangarState.projectId === activeTask.projectId
      && shouldAutoRunOnDrop(hangarState.config, {
        metadata: activeTask.metadata,
        fromColumnId: original?.columnId ?? null,
        toColumnId: targetColumnId,
      })

    onTaskMove?.(updates, baseline, armed ? { autoRunTaskId: activeTask.id, armedAt: Date.now() } : undefined)
  }, [sortedColumns, onTaskMove])

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

    // Touch: the long-press lifted the card and the finger let go in place.
    // That is the hold-to-move gesture, not a drop — arm move mode and leave
    // the board exactly as it was.
    if (isHoldRelease(event)) {
      useBoardStore.getState().setMovingTaskId(activeId)
      return
    }

    const targetColumnId = over ? resolveTargetColumnId(over.id as string, sortedColumns) : null

    if (!targetColumnId) {
      if (pendingMove) {
        const isDone = sortedColumns.find((c) => c.id === pendingMove.columnId)?.name.toLowerCase() === 'done'
        onTaskMove?.([{ id: pendingMove.id, orderIndex: pendingMove.orderIndex, columnId: pendingMove.columnId, name: pendingMove.name, ...(isDone && { status: 'done' }) }], snapshot ?? undefined)
      }
      return
    }

    const index = resolveDropIndex(activeTask, targetColumnId, pointerYRef.current ?? pointerYFromEvent(event))
    commitMove(activeTask, targetColumnId, index, snapshot)
  }, [sortedColumns, removeTask, reorderColumns, resolveDropIndex, commitMove, onTaskMove, onTaskDelete, onColumnReorder])

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

  // Hold-to-move placement: the lifted card lands before/after the tapped
  // card or at the end of the tapped column, through the same commit as a
  // drop. Nothing has moved in the store yet, so the baseline is "now".
  const placeMovingTask = useCallback((target: PlacementTarget) => {
    const { tasks, movingTaskId, setMovingTaskId } = useBoardStore.getState()
    if (!movingTaskId) return
    setMovingTaskId(null)
    const activeTask = tasks.find((t) => t.id === movingTaskId)
    if (!activeTask) return
    if (target.kind === 'card' && target.taskId === activeTask.id) return
    const { orderedIds } = columnOrder(target.columnId)
    commitMove(activeTask, target.columnId, placementIndex(orderedIds, activeTask.id, target), null)
  }, [commitMove])

  return {
    sensors,
    activeItem,
    overId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    commitMove,
    placeMovingTask,
  }
}
