'use client'

import { useCallback, useMemo } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import { planMoveAllToColumn, maxOrderIndex } from '@/lib/utils/bulkMovePlan'
import { moveAllTasksToColumnAction } from '@/lib/actions/boardBulk'
import { reorderBoardTasks } from '@/lib/actions/board'
import { toast } from '@/components/ui/Toast'

export interface MoveAllTarget {
  id: string
  name: string
}

/**
 * Board-level lifecycle of "move all cards to…": every card of the source
 * column lands at the end of the target instantly (the server computes the
 * same slots inside a transaction), a failed write puts each card back where
 * it was, and a successful one offers a batch Undo through the toast (also
 * Ctrl+Z, via the undo store the toast registers in).
 */
export function useMoveAllCards(projectId: string) {
  const moveAll = useCallback(async (sourceColumnId: string, target: MoveAllTarget) => {
    const store = useBoardStore.getState()
    const moving = store.tasks.filter((t) => t.columnId === sourceColumnId)
    if (moving.length === 0) return
    const previous = moving.map((t) => ({ id: t.id, columnId: t.columnId!, orderIndex: t.orderIndex }))
    const plan = planMoveAllToColumn(moving, maxOrderIndex(store.tasks.filter((t) => t.columnId === target.id)))
    const restore = () => {
      const { moveTask } = useBoardStore.getState()
      previous.forEach((p) => moveTask(p.id, p.columnId, p.orderIndex))
    }
    plan.forEach((p) => store.moveTask(p.id, target.id, p.orderIndex))
    const count = moving.length
    try {
      await moveAllTasksToColumnAction(projectId, sourceColumnId, target.id)
      useBoardStore.getState().markClean()
      toast(`Moved ${count} card${count === 1 ? '' : 's'} to ${target.name}`, {
        onUndo: () => {
          restore()
          reorderBoardTasks(projectId, previous.map((p) => ({ id: p.id, orderIndex: p.orderIndex, columnId: p.columnId })))
            .then(() => useBoardStore.getState().markClean())
            .catch((err) => toast(err instanceof Error ? err.message : 'Could not undo the move', { force: true }))
        },
      })
    } catch (err) {
      restore()
      toast(err instanceof Error ? err.message : 'Could not move cards — reverted', { force: true })
    }
  }, [projectId])

  return useMemo(() => ({ moveAll }), [moveAll])
}
