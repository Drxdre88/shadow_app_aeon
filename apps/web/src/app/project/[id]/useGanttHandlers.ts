'use client'

import { useState, useCallback } from 'react'
import { createGanttTask, updateGanttTask, deleteGanttTask, updateRow as updateRowAction } from '@/lib/actions/gantt'
import { createGanttView as createGanttViewAction, updateGanttView as updateGanttViewAction, deleteGanttView as deleteGanttViewAction, resetGanttData, reflowGanttView } from '@/lib/actions/ganttViews'
import { pushToGantt } from '@/lib/actions/bridge'
import { updateBoardTask } from '@/lib/actions/board'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'

export function useGanttHandlers(projectId: string, setActiveTab: (tab: 'board' | 'gantt' | 'canvas' | 'trophy') => void, triggerReload: () => void) {
  const [ganttEditTaskId, setGanttEditTaskId] = useState<string | null>(null)
  const [ganttFormData, setGanttFormData] = useState<{ name: string; description: string; color: string; priority: 'low' | 'medium' | 'high' | 'urgent'; size: number | null }>({ name: '', description: '', color: 'purple', priority: 'medium', size: null })

  const handleGanttTaskCreate = useCallback((task: {
    id: string
    projectId: string
    rowId: string
    name: string
    startDate: string
    endDate: string
    color: string
    progress?: number
  }) => {
    createGanttTask(task).catch((err) => console.error('Failed to create gantt task:', err))
  }, [])

  const handleGanttTaskUpdate = useCallback((taskId: string, updates: Record<string, unknown>) => {
    updateGanttTask(taskId, projectId, updates as {
      rowId?: string
      name?: string
      startDate?: string
      endDate?: string
      color?: string
      progress?: number
    }).catch((err) => console.error('Failed to update gantt task:', err))
  }, [projectId])

  const handleGanttTaskDelete = useCallback((taskId: string) => {
    deleteGanttTask(taskId, projectId).catch((err) => console.error('Failed to delete gantt task:', err))
  }, [projectId])

  const handleGanttViewCreate = useCallback((view: { id: string; projectId: string; name: string; groupBy: string; excludedSections?: string[]; taskOrder?: string; allowWeekends?: boolean; allowMultipleRows?: boolean; allowOverlap?: boolean }) => {
    const { addView } = useGanttStore.getState()
    const filters: Record<string, unknown> = {}
    if (view.excludedSections && view.excludedSections.length > 0) {
      filters.excludedSections = view.excludedSections
    }
    if (view.taskOrder) filters.taskOrder = view.taskOrder
    filters.allowWeekends = view.allowWeekends ?? false
    filters.allowMultipleRows = view.allowMultipleRows ?? false
    filters.allowOverlap = view.allowOverlap ?? false
    addView({ ...view, filters })
    createGanttViewAction(view).then(() => {
      triggerReload()
    }).catch((err) => console.error('Failed to create gantt view:', err))
  }, [triggerReload])

  const handleGanttViewUpdate = useCallback((view: { id: string; projectId: string; name: string; groupBy: string; excludedSections?: string[]; taskOrder?: string; allowWeekends?: boolean; allowMultipleRows?: boolean; allowOverlap?: boolean }) => {
    const { setViews, views } = useGanttStore.getState()
    const filters: Record<string, unknown> = {}
    if (view.excludedSections && view.excludedSections.length > 0) {
      filters.excludedSections = view.excludedSections
    }
    if (view.taskOrder) filters.taskOrder = view.taskOrder
    filters.allowWeekends = view.allowWeekends ?? false
    filters.allowMultipleRows = view.allowMultipleRows ?? false
    filters.allowOverlap = view.allowOverlap ?? false
    setViews(views.map((v) => v.id === view.id ? { ...v, name: view.name, groupBy: view.groupBy, filters } : v))
    updateGanttViewAction(view.id, view.projectId, {
      name: view.name,
      groupBy: view.groupBy,
      filters,
    }).then(() => {
      triggerReload()
    }).catch((err) => console.error('Failed to update gantt view:', err))
  }, [triggerReload])

  const handleGanttViewDelete = useCallback((viewId: string) => {
    const { removeView } = useGanttStore.getState()
    removeView(viewId)
    deleteGanttViewAction(viewId, projectId).catch((err) => console.error('Failed to delete gantt view:', err))
  }, [projectId])

  const handleGanttReflow = useCallback(() => {
    const { activeViewId } = useGanttStore.getState()
    if (!activeViewId) return
    reflowGanttView(projectId, activeViewId).then(() => {
      triggerReload()
    }).catch((err) => console.error('Failed to reflow gantt:', err))
  }, [projectId, triggerReload])

  const handleGanttReset = useCallback(() => {
    const { setViews, setActiveViewId, setRows: setGanttRows, setTasks: resetGanttTasks } = useGanttStore.getState()
    setViews([])
    setActiveViewId(null)
    setGanttRows([])
    resetGanttTasks([])
    resetGanttData(projectId).then(() => {
      triggerReload()
    }).catch((err) => console.error('Failed to reset gantt:', err))
  }, [projectId, triggerReload])

  const handleGanttTaskClick = useCallback((boardTaskId: string) => {
    const task = useBoardStore.getState().tasks.find((t) => t.id === boardTaskId)
    if (!task) return
    setGanttFormData({
      name: task.name,
      description: task.description || '',
      color: task.color,
      priority: task.priority,
      size: task.size ?? null,
    })
    setGanttEditTaskId(boardTaskId)
  }, [])

  const handleGanttEditSubmit = useCallback(() => {
    if (!ganttEditTaskId) return
    const { updateTask } = useBoardStore.getState()
    updateTask(ganttEditTaskId, {
      name: ganttFormData.name,
      description: ganttFormData.description || undefined,
      color: ganttFormData.color,
      priority: ganttFormData.priority,
      size: ganttFormData.size,
    })
    updateBoardTask(ganttEditTaskId, projectId, {
      name: ganttFormData.name,
      description: ganttFormData.description || null,
      color: ganttFormData.color,
      priority: ganttFormData.priority,
    }).catch((err) => console.error('Failed to update task from gantt:', err))
    setGanttEditTaskId(null)
  }, [ganttEditTaskId, ganttFormData, projectId])

  const handlePushToGantt = useCallback((boardTaskId: string) => {
    const { activeViewId } = useGanttStore.getState()
    if (!activeViewId) {
      setActiveTab('gantt')
      return
    }
    const ganttTaskId = crypto.randomUUID()
    const { updateTask: updateBoardTaskStore } = useBoardStore.getState()
    updateBoardTaskStore(boardTaskId, { onTimeline: true, ganttTaskId })

    pushToGantt({
      boardTaskId,
      projectId,
      ganttViewId: activeViewId,
      ganttTaskId,
    }).then((ganttTask) => {
      if (ganttTask) {
        const { addTask } = useGanttStore.getState()
        addTask({
          id: ganttTask.id,
          projectId: ganttTask.projectId,
          rowId: ganttTask.rowId || '',
          name: ganttTask.name,
          startDate: ganttTask.startDate instanceof Date ? ganttTask.startDate.toISOString() : String(ganttTask.startDate),
          endDate: ganttTask.endDate instanceof Date ? ganttTask.endDate.toISOString() : String(ganttTask.endDate),
          color: ganttTask.color,
          progress: ganttTask.progress,
          dependencies: [],
          boardTaskId: boardTaskId,
        })
      }
    }).catch((err) => {
      console.error('Failed to push to gantt:', err)
      updateBoardTaskStore(boardTaskId, { onTimeline: false, ganttTaskId: null })
    })
  }, [projectId, setActiveTab])

  const handleGanttRowUpdate = useCallback((rowId: string, updates: { name?: string }) => {
    updateRowAction(rowId, projectId, updates).catch((err) => console.error('Failed to update row:', err))
  }, [projectId])

  return {
    ganttEditTaskId,
    setGanttEditTaskId,
    ganttFormData,
    setGanttFormData,
    handleGanttTaskCreate,
    handleGanttTaskUpdate,
    handleGanttTaskDelete,
    handleGanttViewCreate,
    handleGanttViewUpdate,
    handleGanttViewDelete,
    handleGanttReflow,
    handleGanttReset,
    handleGanttTaskClick,
    handleGanttEditSubmit,
    handlePushToGantt,
    handleGanttRowUpdate,
  }
}
