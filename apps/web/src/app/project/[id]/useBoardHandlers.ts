'use client'

import { useState, useCallback } from 'react'
import { createBoardTask, updateBoardTask, reorderBoardTasks, archiveBoardTask, archiveColumnTasks } from '@/lib/actions/board'
import { createColumn, updateColumn as updateColumnAction, reorderColumns as reorderColumnsAction, deleteColumn as deleteColumnAction } from '@/lib/actions/columns'
import { sendToVault, sendBatchToVault } from '@/lib/actions/vault'
import { useBoardStore, beginDirectWrite, endDirectWrite } from '@/lib/store/boardStore'
import { useMutationQueue } from '@/lib/store/mutationQueue'
import { toast } from '@/components/ui/Toast'

export function useBoardHandlers(projectId: string) {
  const [vaultTarget, setVaultTarget] = useState<{ taskId: string; taskName: string } | null>(null)
  const [batchVaultTarget, setBatchVaultTarget] = useState<{ columnId: string; columnName: string; tasks: { id: string; name: string; priority: string }[] } | null>(null)
  const [showArchive, setShowArchive] = useState(false)

  const handleTaskCreate = useCallback((task: {
    id: string
    projectId: string
    name: string
    description?: string
    columnId?: string
    status: string
    priority: string
    color: string
    labels?: string[]
    onTimeline: boolean
    size?: number | null
    progress?: number | null
    orderIndex: number
    startDate?: string
    endDate?: string
  }) => {
    useMutationQueue.getState().enqueue(
      { id: crypto.randomUUID(), type: 'task.create', args: task },
      {
        rollback: () => useBoardStore.getState().removeTask(task.id),
        failMessage: 'Could not create card — reverted',
      },
    )
  }, [])

  const handleTaskUpdate = useCallback((taskId: string, updates: Record<string, unknown>, options?: { silent?: boolean }) => {
    const { tasks } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === taskId)
    const changedFields = Object.keys(updates)
    // Autosave fires this on every debounce; suppress the undo toast for those.
    const isUndoable = !options?.silent && changedFields.some(k => ['priority', 'color', 'name'].includes(k))

    const buildRollback = (): Record<string, unknown> => {
      const rb: Record<string, unknown> = {}
      if (snapshot) for (const key of changedFields) rb[key] = (snapshot as unknown as Record<string, unknown>)[key]
      return rb
    }

    useMutationQueue.getState().enqueue(
      { id: crypto.randomUUID(), type: 'task.update', args: { taskId, projectId, updates } },
      {
        failMessage: 'Could not save card — reverted',
        rollback: () => {
          if (snapshot) useBoardStore.getState().updateTask(taskId, buildRollback() as Partial<typeof snapshot>)
        },
        onSuccess: () => {
          if (isUndoable && snapshot) {
            const rollback = buildRollback()
            toast('Task updated', {
              onUndo: () => {
                useBoardStore.getState().updateTask(taskId, rollback as Partial<typeof snapshot>)
                updateBoardTask(taskId, projectId, rollback as Record<string, unknown>).catch(() => toast('Failed to undo'))
              },
            })
          }
        },
      },
    )
  }, [projectId])

  const handleTaskDelete = useCallback((taskId: string) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === taskId)
    removeTask(taskId)
    useMutationQueue.getState().enqueue(
      { id: crypto.randomUUID(), type: 'task.delete', args: { taskId, projectId } },
      {
      failMessage: 'Could not delete card — restored',
      rollback: () => { if (snapshot) addTask(snapshot) },
      onSuccess: () => {
        if (snapshot) {
          toast('Task deleted', {
            onUndo: () => {
              addTask(snapshot)
              createBoardTask({
                id: snapshot.id,
                projectId: snapshot.projectId,
                name: snapshot.name,
                description: snapshot.description,
                columnId: snapshot.columnId,
                status: snapshot.status,
                priority: snapshot.priority,
                color: snapshot.color,
                labels: snapshot.labels,
                onTimeline: snapshot.onTimeline,
                size: snapshot.size,
                progress: snapshot.progress,
                orderIndex: snapshot.orderIndex,
                startDate: snapshot.startDate,
                endDate: snapshot.endDate,
              }).catch(() => toast('Failed to restore task'))
            },
          })
        }
      },
    })
  }, [projectId])

  const handleTaskMove = useCallback((
    updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[],
    snapshot?: { id: string; columnId?: string; orderIndex: number }[]
  ) => {
    useMutationQueue.getState().enqueue(
      { id: crypto.randomUUID(), type: 'task.move', args: { projectId, updates } },
      {
      failMessage: 'Could not move card — reverted',
      rollback: () => {
        if (snapshot) {
          const { moveTask, updateTask: storeUpdate } = useBoardStore.getState()
          for (const snap of snapshot) {
            if (snap.columnId) moveTask(snap.id, snap.columnId, snap.orderIndex)
            else storeUpdate(snap.id, { orderIndex: snap.orderIndex })
          }
        }
      },
      onSuccess: () => {
        if (snapshot && snapshot.length > 0) {
          const snapshotMap = new Map(snapshot.map(s => [s.id, s]))
          const movedAcrossColumns = updates.some(u => u.columnId && u.columnId !== snapshotMap.get(u.id)?.columnId)
          if (movedAcrossColumns) {
            const movedId = updates.find(u => u.columnId && u.columnId !== snapshotMap.get(u.id)?.columnId)?.id
            const taskName = (movedId && useBoardStore.getState().tasks.find(t => t.id === movedId)?.name) || 'Task'
            const frozenSnapshot = snapshot.map(s => ({ ...s }))
            toast(`Moved "${taskName}"`, {
              onUndo: () => {
                const { moveTask, updateTask: storeUpdate } = useBoardStore.getState()
                for (const snap of frozenSnapshot) {
                  if (snap.columnId) moveTask(snap.id, snap.columnId, snap.orderIndex)
                  else storeUpdate(snap.id, { orderIndex: snap.orderIndex })
                }
                reorderBoardTasks(projectId, frozenSnapshot.map(s => ({
                  id: s.id,
                  orderIndex: s.orderIndex,
                  ...(s.columnId ? { columnId: s.columnId } : {}),
                }))).catch(() => toast('Failed to undo move'))
              },
            })
          }
        }
      },
    })
  }, [projectId])

  const handleColumnCreate = useCallback((col: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => {
    beginDirectWrite()
    createColumn(projectId, { name: col.name, color: col.color, orderIndex: col.orderIndex }, col.id)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
      })
      .catch((err) => {
        console.error('Failed to create column:', err)
        useBoardStore.getState().removeColumn(col.id)
        useBoardStore.setState({ isDirty: false })
        toast('Failed to create column')
      })
      .finally(endDirectWrite)
  }, [projectId])

  const handleColumnUpdate = useCallback((columnId: string, updates: { name?: string; color?: string }) => {
    const snapshot = useBoardStore.getState().columns.find(c => c.id === columnId)
    beginDirectWrite()
    updateColumnAction(columnId, projectId, updates)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
        if (snapshot) {
          const rollback: Record<string, unknown> = {}
          for (const key of Object.keys(updates)) {
            rollback[key] = (snapshot as unknown as Record<string, unknown>)[key]
          }
          toast('Column updated', {
            onUndo: () => {
              useBoardStore.getState().updateColumn(columnId, rollback as Partial<typeof snapshot>)
              updateColumnAction(columnId, projectId, rollback as { name?: string; color?: string }).catch(() => toast('Failed to undo'))
            },
          })
        }
      })
      .catch((err) => {
        console.error('Failed to update column:', err)
        useBoardStore.setState({ isDirty: false })
        if (snapshot) {
          useBoardStore.getState().updateColumn(columnId, snapshot)
          toast('Failed to update column')
        }
      })
      .finally(endDirectWrite)
  }, [projectId])

  const handleColumnReorder = useCallback((updates: { id: string; orderIndex: number }[]) => {
    const snapshot = useBoardStore.getState().columns.map(c => ({ id: c.id, orderIndex: c.orderIndex }))
    beginDirectWrite()
    reorderColumnsAction(projectId, updates)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
      })
      .catch((err) => {
        console.error('Failed to reorder columns:', err)
        snapshot.forEach(s => useBoardStore.getState().updateColumn(s.id, { orderIndex: s.orderIndex }))
        useBoardStore.setState({ isDirty: false })
        toast('Failed to reorder columns')
      })
      .finally(endDirectWrite)
  }, [projectId])

  const handleColumnDelete = useCallback((columnId: string) => {
    const { tasks, columns, removeTask, removeColumn, addColumn, addTask } = useBoardStore.getState()
    const colSnapshot = columns.find(c => c.id === columnId)
    const taskSnapshots = tasks.filter(t => t.columnId === columnId)
    taskSnapshots.forEach(t => removeTask(t.id))
    removeColumn(columnId)
    beginDirectWrite()
    deleteColumnAction(columnId, projectId)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
        if (colSnapshot) {
          const frozenCol = { ...colSnapshot }
          const frozenTasks = taskSnapshots.map(t => ({ ...t }))
          toast(`Deleted column "${frozenCol.name}"`, {
            onUndo: () => {
              addColumn(frozenCol)
              createColumn(projectId, { name: frozenCol.name, color: frozenCol.color, orderIndex: frozenCol.orderIndex }, frozenCol.id)
                .then(() => {
                  frozenTasks.forEach(t => {
                    addTask(t)
                    createBoardTask({
                      id: t.id,
                      projectId: t.projectId,
                      name: t.name,
                      description: t.description,
                      columnId: t.columnId,
                      status: t.status,
                      priority: t.priority,
                      color: t.color,
                      labels: t.labels,
                      onTimeline: t.onTimeline,
                      size: t.size,
                      progress: t.progress,
                      orderIndex: t.orderIndex,
                      startDate: t.startDate,
                      endDate: t.endDate,
                    }).catch(() => toast('Failed to restore some tasks'))
                  })
                })
                .catch(() => toast('Failed to restore column'))
            },
          })
        }
      })
      .catch((err) => {
        console.error('Failed to delete column:', err)
        if (colSnapshot) addColumn(colSnapshot)
        taskSnapshots.forEach(t => addTask(t))
        toast('Failed to delete column')
      })
      .finally(endDirectWrite)
  }, [projectId])

  const handleSendToVault = useCallback((taskId: string) => {
    const { tasks } = useBoardStore.getState()
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status !== 'done') return
    setVaultTarget({ taskId, taskName: task.name })
  }, [])

  const handleVaultConfirm = useCallback((daysTaken: number | null) => {
    if (!vaultTarget) return
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === vaultTarget.taskId)
    removeTask(vaultTarget.taskId)
    sendToVault(vaultTarget.taskId, projectId, daysTaken, vaultTarget.taskName).catch((err) => {
      console.error('Failed to vault task:', err)
      if (snapshot) addTask(snapshot)
      toast('Failed to send to vault')
    })
    setVaultTarget(null)
  }, [vaultTarget, projectId])

  const handleVaultCompleted = useCallback((columnId: string) => {
    const { tasks, columns } = useBoardStore.getState()
    const column = columns.find(c => c.id === columnId)
    const doneTasks = tasks.filter(t => t.columnId === columnId && t.status === 'done')
    if (doneTasks.length === 0) return
    setBatchVaultTarget({
      columnId,
      columnName: column?.name ?? 'Column',
      tasks: doneTasks.map(t => ({ id: t.id, name: t.name, priority: t.priority })),
    })
  }, [])

  const handleBatchVaultConfirm = useCallback((entries: { taskId: string; daysTaken: number | null; taskName: string }[]) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshots = entries.map(e => tasks.find(t => t.id === e.taskId)).filter(Boolean)
    entries.forEach(e => removeTask(e.taskId))
    sendBatchToVault(projectId, entries).catch((err) => {
      console.error('Failed to batch vault:', err)
      snapshots.forEach(s => { if (s) addTask(s) })
      toast('Failed to send to vault')
    })
    setBatchVaultTarget(null)
  }, [projectId])

  const handleArchiveTask = useCallback((taskId: string) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === taskId)
    removeTask(taskId)
    archiveBoardTask(taskId, projectId).catch((err) => {
      console.error('Failed to archive task:', err)
      if (snapshot) addTask(snapshot)
      toast('Failed to archive task')
    })
  }, [projectId])

  const handleArchiveColumn = useCallback((columnId: string) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const columnTasks = tasks.filter(t => t.columnId === columnId)
    columnTasks.forEach(t => removeTask(t.id))
    archiveColumnTasks(projectId, columnId).catch((err) => {
      console.error('Failed to archive column tasks:', err)
      columnTasks.forEach(t => addTask(t))
      toast('Failed to archive column tasks')
    })
  }, [projectId])

  return {
    vaultTarget,
    setVaultTarget,
    batchVaultTarget,
    setBatchVaultTarget,
    showArchive,
    setShowArchive,
    handleTaskCreate,
    handleTaskUpdate,
    handleTaskDelete,
    handleTaskMove,
    handleColumnCreate,
    handleColumnUpdate,
    handleColumnReorder,
    handleColumnDelete,
    handleSendToVault,
    handleVaultConfirm,
    handleVaultCompleted,
    handleBatchVaultConfirm,
    handleArchiveTask,
    handleArchiveColumn,
  }
}
