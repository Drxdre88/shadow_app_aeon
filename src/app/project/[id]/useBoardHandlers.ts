'use client'

import { useState, useCallback } from 'react'
import { createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks, archiveBoardTask, archiveColumnTasks } from '@/lib/actions/board'
import { createColumn, updateColumn as updateColumnAction, reorderColumns as reorderColumnsAction, deleteColumn as deleteColumnAction } from '@/lib/actions/columns'
import { sendToVault, sendBatchToVault } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'
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
    onTimeline: boolean
    orderIndex: number
    startDate?: string
    endDate?: string
  }) => {
    createBoardTask(task)
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => {
        console.error('Failed to create task:', err)
        useBoardStore.getState().removeTask(task.id)
        useBoardStore.setState({ isDirty: false })
        toast('Failed to create task')
      })
  }, [])

  const handleTaskUpdate = useCallback((taskId: string, updates: Record<string, unknown>) => {
    updateBoardTask(taskId, projectId, updates as {
      name?: string
      description?: string | null
      columnId?: string
      status?: string
      priority?: string
      color?: string
      onTimeline?: boolean
      orderIndex?: number
    })
      .then(() => {
        useBoardStore.setState({ isDirty: false })
      })
      .catch((err) => {
        console.error('Failed to update task:', err)
        useBoardStore.setState({ isDirty: false })
        toast('Failed to update task')
      })
  }, [projectId])

  const handleTaskDelete = useCallback((taskId: string) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === taskId)
    removeTask(taskId)
    deleteBoardTask(taskId, projectId)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
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
                onTimeline: snapshot.onTimeline,
                orderIndex: snapshot.orderIndex,
                startDate: snapshot.startDate,
                endDate: snapshot.endDate,
              }).catch(() => toast('Failed to restore task'))
            },
          })
        }
      })
      .catch((err) => {
        console.error('Failed to delete task:', err)
        useBoardStore.setState({ isDirty: false })
        if (snapshot) addTask(snapshot)
        toast('Failed to delete task')
      })
  }, [projectId])

  const handleTaskMove = useCallback((
    updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[],
    snapshot?: { id: string; columnId?: string; orderIndex: number }[]
  ) => {
    reorderBoardTasks(projectId, updates)
      .then(() => {
        useBoardStore.setState({ isDirty: false })
      })
      .catch((err) => {
        console.error('Failed to reorder tasks:', err)
        if (snapshot) {
          const { moveTask, updateTask: storeUpdate } = useBoardStore.getState()
          for (const snap of snapshot) {
            if (snap.columnId) {
              moveTask(snap.id, snap.columnId, snap.orderIndex)
            } else {
              storeUpdate(snap.id, { orderIndex: snap.orderIndex })
            }
          }
        }
        useBoardStore.setState({ isDirty: false })
        toast('Failed to move task')
      })
  }, [projectId])

  const handleColumnCreate = useCallback((col: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => {
    createColumn(projectId, { name: col.name, color: col.color, orderIndex: col.orderIndex }, col.id)
      .catch((err) => {
        console.error('Failed to create column:', err)
        useBoardStore.getState().removeColumn(col.id)
        useBoardStore.setState({ isDirty: false })
        toast('Failed to create column')
      })
  }, [projectId])

  const handleColumnUpdate = useCallback((columnId: string, updates: { name?: string; color?: string }) => {
    const snapshot = useBoardStore.getState().columns.find(c => c.id === columnId)
    updateColumnAction(columnId, projectId, updates)
      .catch((err) => {
        console.error('Failed to update column:', err)
        useBoardStore.setState({ isDirty: false })
        if (snapshot) {
          useBoardStore.getState().updateColumn(columnId, snapshot)
          toast('Failed to update column')
        }
      })
  }, [projectId])

  const handleColumnReorder = useCallback((updates: { id: string; orderIndex: number }[]) => {
    const snapshot = useBoardStore.getState().columns.map(c => ({ id: c.id, orderIndex: c.orderIndex }))
    reorderColumnsAction(projectId, updates)
      .catch((err) => {
        console.error('Failed to reorder columns:', err)
        useBoardStore.setState({ isDirty: false })
        snapshot.forEach(s => useBoardStore.getState().updateColumn(s.id, { orderIndex: s.orderIndex }))
        toast('Failed to reorder columns')
      })
  }, [projectId])

  const handleColumnDelete = useCallback((columnId: string) => {
    const { tasks, columns, removeTask, removeColumn, addColumn, addTask } = useBoardStore.getState()
    const colSnapshot = columns.find(c => c.id === columnId)
    const taskSnapshots = tasks.filter(t => t.columnId === columnId)
    taskSnapshots.forEach(t => removeTask(t.id))
    removeColumn(columnId)
    deleteColumnAction(columnId, projectId)
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => {
        console.error('Failed to delete column:', err)
        if (colSnapshot) addColumn(colSnapshot)
        taskSnapshots.forEach(t => addTask(t))
        toast('Failed to delete column')
      })
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
