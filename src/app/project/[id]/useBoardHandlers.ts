'use client'

import { useState, useCallback } from 'react'
import { createBoardTask, updateBoardTask, deleteBoardTask, reorderBoardTasks, archiveBoardTask, archiveColumnTasks } from '@/lib/actions/board'
import { createColumn, updateColumn as updateColumnAction, reorderColumns as reorderColumnsAction, deleteColumn as deleteColumnAction } from '@/lib/actions/columns'
import { sendToVault, sendBatchToVault } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'

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
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => console.error('Failed to update task:', err))
  }, [projectId])

  const handleTaskDelete = useCallback((taskId: string) => {
    const { tasks, removeTask, addTask } = useBoardStore.getState()
    const snapshot = tasks.find(t => t.id === taskId)
    removeTask(taskId)
    deleteBoardTask(taskId, projectId)
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => {
        console.error('Failed to delete task:', err)
        if (snapshot) addTask(snapshot)
      })
  }, [projectId])

  const handleTaskMove = useCallback((updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[]) => {
    reorderBoardTasks(projectId, updates)
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => console.error('Failed to reorder tasks:', err))
  }, [projectId])

  const handleColumnCreate = useCallback((col: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => {
    createColumn(projectId, { name: col.name, color: col.color, orderIndex: col.orderIndex }, col.id)
      .catch((err) => console.error('Failed to create column:', err))
  }, [projectId])

  const handleColumnUpdate = useCallback((columnId: string, updates: { name?: string; color?: string }) => {
    updateColumnAction(columnId, projectId, updates)
      .catch((err) => console.error('Failed to update column:', err))
  }, [projectId])

  const handleColumnReorder = useCallback((updates: { id: string; orderIndex: number }[]) => {
    reorderColumnsAction(projectId, updates)
      .catch((err) => console.error('Failed to reorder columns:', err))
  }, [projectId])

  const handleColumnDelete = useCallback((columnId: string) => {
    const { tasks, removeTask, removeColumn } = useBoardStore.getState()
    tasks.filter(t => t.columnId === columnId).forEach(t => removeTask(t.id))
    removeColumn(columnId)
    deleteColumnAction(columnId, projectId)
      .then(() => useBoardStore.setState({ isDirty: false }))
      .catch((err) => console.error('Failed to delete column:', err))
  }, [projectId])

  const handleSendToVault = useCallback((taskId: string) => {
    const { tasks } = useBoardStore.getState()
    const task = tasks.find(t => t.id === taskId)
    if (!task || task.status !== 'done') return
    setVaultTarget({ taskId, taskName: task.name })
  }, [])

  const handleVaultConfirm = useCallback((daysTaken: number | null) => {
    if (!vaultTarget) return
    const { removeTask } = useBoardStore.getState()
    removeTask(vaultTarget.taskId)
    sendToVault(vaultTarget.taskId, projectId, daysTaken, vaultTarget.taskName).catch((err) => {
      console.error('Failed to vault task:', err)
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
    const { removeTask } = useBoardStore.getState()
    entries.forEach(e => removeTask(e.taskId))
    sendBatchToVault(projectId, entries).catch((err) => {
      console.error('Failed to batch vault:', err)
    })
    setBatchVaultTarget(null)
  }, [projectId])

  const handleArchiveTask = useCallback((taskId: string) => {
    const { removeTask } = useBoardStore.getState()
    removeTask(taskId)
    archiveBoardTask(taskId, projectId).catch((err) => console.error('Failed to archive task:', err))
  }, [projectId])

  const handleArchiveColumn = useCallback((columnId: string) => {
    const { tasks, removeTask } = useBoardStore.getState()
    const columnTasks = tasks.filter(t => t.columnId === columnId)
    columnTasks.forEach(t => removeTask(t.id))
    archiveColumnTasks(projectId, columnId).catch((err) => console.error('Failed to archive column tasks:', err))
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
