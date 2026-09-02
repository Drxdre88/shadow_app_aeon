'use client'

import { useState, useCallback } from 'react'
import { createGanttTask, updateGanttTask, deleteGanttTask, updateRow as updateRowAction } from '@/lib/actions/gantt'
import { createGanttView as createGanttViewAction, updateGanttView as updateGanttViewAction, deleteGanttView as deleteGanttViewAction, resetGanttData, reflowGanttView } from '@/lib/actions/ganttViews'
import { pushToGantt } from '@/lib/actions/bridge'
import { updateBoardTask } from '@/lib/actions/board'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore, beginDirectWrite, endDirectWrite } from '@/lib/store/boardStore'
import { toast } from '@/components/ui/Toast'
import type { TimelineResetSnapshotEntry } from '@/lib/data/ganttViews'

export function useGanttHandlers(projectId: string, setActiveTab: (tab: 'board' | 'gantt' | 'canvas' | 'trophy') => void, triggerReload: () => void) {
  const [ganttEditTaskId, setGanttEditTaskId] = useState<string | null>(null)
  const [ganttFormData, setGanttFormData] = useState<{ name: string; description: string; color: string; priority: 'low' | 'medium' | 'high' | 'urgent'; size: number | null }>({ name: '', description: '', color: 'purple', priority: 'medium', size: null })
  const [ganttResetOpen, setGanttResetOpen] = useState(false)
  const [isGanttResetting, setIsGanttResetting] = useState(false)

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

  const openGanttReset = useCallback(() => setGanttResetOpen(true), [])
  const closeGanttReset = useCallback(() => { if (!isGanttResetting) setGanttResetOpen(false) }, [isGanttResetting])

  const handleGanttReset = useCallback(() => {
    if (isGanttResetting) return
    const { setViews, setActiveViewId, setRows: setGanttRows, setTasks: resetGanttTasks } = useGanttStore.getState()
    const { tasks, updateTask: updateBoardTaskStore } = useBoardStore.getState()
    const clientSnapshot: TimelineResetSnapshotEntry[] = tasks
      .filter((t) => t.onTimeline || !!t.ganttTaskId)
      .map((t) => ({ id: t.id, startDate: t.startDate ?? null, endDate: t.endDate ?? null, onTimeline: t.onTimeline }))

    const applySnapshot = (snapshot: TimelineResetSnapshotEntry[]) => {
      for (const t of snapshot) {
        updateBoardTaskStore(t.id, { onTimeline: t.onTimeline, startDate: t.startDate ?? undefined, endDate: t.endDate ?? undefined })
      }
    }

    setIsGanttResetting(true)
    for (const t of clientSnapshot) {
      updateBoardTaskStore(t.id, { onTimeline: false, ganttTaskId: null, startDate: undefined, endDate: undefined })
    }
    setViews([])
    setActiveViewId(null)
    setGanttRows([])
    resetGanttTasks([])

    beginDirectWrite()
    resetGanttData(projectId)
      .then((serverSnapshot) => {
        useBoardStore.setState({ isDirty: false })
        setGanttResetOpen(false)
        triggerReload()
        const snapshot = serverSnapshot.length > 0 ? serverSnapshot : clientSnapshot
        if (snapshot.length === 0) {
          toast('Timeline reset', { force: true })
          return
        }
        const frozen = snapshot.map((t) => ({ ...t }))
        toast(`Timeline reset — ${frozen.length} card${frozen.length === 1 ? '' : 's'} taken off`, {
          force: true,
          duration: 10000,
          onUndo: () => {
            applySnapshot(frozen)
            Promise.all(frozen.map((t) =>
              updateBoardTask(t.id, projectId, { onTimeline: t.onTimeline, startDate: t.startDate, endDate: t.endDate })
            ))
              .then(() => triggerReload())
              .catch(() => toast('Failed to restore timeline dates', { force: true }))
          },
        })
      })
      .catch((err) => {
        console.error('Failed to reset gantt:', err)
        applySnapshot(clientSnapshot)
        triggerReload()
        toast('Could not reset the timeline — dates restored', { force: true })
      })
      .finally(() => {
        endDirectWrite()
        setIsGanttResetting(false)
      })
  }, [projectId, triggerReload, isGanttResetting])

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
      size: ganttFormData.size,
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
    const { tasks, updateTask: updateBoardTaskStore } = useBoardStore.getState()
    const previous = tasks.find((t) => t.id === boardTaskId)
    const previousOnTimeline = previous?.onTimeline ?? false
    const previousGanttTaskId = previous?.ganttTaskId ?? null
    updateBoardTaskStore(boardTaskId, { onTimeline: true, ganttTaskId: previousGanttTaskId ?? ganttTaskId })

    pushToGantt({
      boardTaskId,
      projectId,
      ganttViewId: activeViewId,
      ganttTaskId,
    }).then((ganttTask) => {
      if (ganttTask) {
        const { tasks: ganttTasks, addTask, updateTask } = useGanttStore.getState()
        updateBoardTaskStore(boardTaskId, { onTimeline: true, ganttTaskId: previousGanttTaskId ?? ganttTask.id })
        const bar = {
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
        }
        if (ganttTasks.some((t) => t.id === bar.id)) updateTask(bar.id, bar)
        else addTask(bar)
      }
    }).catch((err) => {
      console.error('Failed to push to gantt:', err)
      updateBoardTaskStore(boardTaskId, { onTimeline: previousOnTimeline, ganttTaskId: previousGanttTaskId })
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
    ganttResetOpen,
    isGanttResetting,
    openGanttReset,
    closeGanttReset,
    handleGanttTaskClick,
    handleGanttEditSubmit,
    handlePushToGantt,
    handleGanttRowUpdate,
  }
}
