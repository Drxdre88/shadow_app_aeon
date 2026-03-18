'use client'

import { useState, useEffect, useRef } from 'react'
import { loadBoardData } from '@/lib/actions/board'
import { getRows, getGanttTasks } from '@/lib/actions/gantt'
import { getGanttViews } from '@/lib/actions/ganttViews'
import { getCanvasNodes, getCanvasEdges } from '@/lib/actions/canvas'
import { useBoardStore } from '@/lib/store/boardStore'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useCanvasStore } from '@/lib/store/canvasStore'

export function useProjectData(projectId: string, activeTab: 'board' | 'gantt' | 'canvas' | 'trophy') {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const isInitialLoad = useRef(true)

  const { setTasks: setGanttTasks, setRows } = useGanttStore()
  const { setNodes: setCanvasNodes, setEdges: setCanvasEdges } = useCanvasStore()

  useEffect(() => {
    if (isInitialLoad.current) {
      setIsLoading(true)
      setLoadError(null)
      setGanttTasks([])
      setRows([])
      useBoardStore.setState({ columns: [], labels: [], dependencies: [] })
    }

    loadBoardData(projectId)
      .then(({ tasks: dbTasks, columns: dbColumns, labels: dbLabels, taskLabels: dbTaskLabels, dependencies: dbDependencies, checklistSummaries: dbChecklistSummaries }) => {
        const taskLabelMap = new Map<string, string[]>()
        dbTaskLabels.forEach((tl) => {
          const existing = taskLabelMap.get(tl.taskId) || []
          existing.push(tl.labelId)
          taskLabelMap.set(tl.taskId, existing)
        })

        const columnByOldStatus = new Map<string, string>()
        for (const col of dbColumns) {
          const lower = col.name.toLowerCase()
          if (lower === 'todo') columnByOldStatus.set('todo', col.id)
          else if (lower === 'doing') columnByOldStatus.set('doing', col.id)
          else if (lower === 'review') columnByOldStatus.set('review', col.id)
          else if (lower === 'done') columnByOldStatus.set('done', col.id)
        }
        const firstColumnId = dbColumns[0]?.id

        useBoardStore.setState({
          columns: dbColumns.map((c) => ({
            id: c.id,
            projectId: c.projectId,
            name: c.name,
            color: c.color,
            icon: c.icon,
            orderIndex: c.orderIndex,
          })),
          tasks: dbTasks.map((t) => ({
            id: t.id,
            projectId: t.projectId,
            name: t.name,
            description: t.description || undefined,
            columnId: t.columnId || columnByOldStatus.get(t.status) || firstColumnId,
            status: t.status,
            priority: t.priority as 'low' | 'medium' | 'high' | 'urgent',
            color: t.color,
            labels: taskLabelMap.get(t.id) || [],
            startDate: t.startDate ? t.startDate.toISOString() : undefined,
            endDate: t.endDate ? t.endDate.toISOString() : undefined,
            onTimeline: t.onTimeline,
            size: t.size ?? null,
            ganttTaskId: t.ganttTaskId ?? null,
            orderIndex: t.orderIndex,
            updatedAt: t.updatedAt?.toISOString(),
          })),
          labels: dbLabels.map((l) => ({
            id: l.id,
            projectId: l.projectId,
            name: l.name,
            color: l.color,
          })),
          dependencies: dbDependencies.map((d) => ({
            blockerTaskId: d.blockerTaskId,
            blockedTaskId: d.blockedTaskId,
          })),
          checklistSummaries: dbChecklistSummaries,
          isDirty: false,
        })
      })
      .catch((err) => {
        console.error('Failed to load project data:', err)
        if (isInitialLoad.current) {
          setLoadError('Failed to load project data. Check your connection and try again.')
        }
      })
      .finally(() => {
        setIsLoading(false)
        isInitialLoad.current = false
      })
  }, [projectId, loadKey])

  useEffect(() => {
    if (activeTab !== 'gantt' || isLoading) return
    Promise.all([
      getRows(projectId),
      getGanttTasks(projectId),
      getGanttViews(projectId),
    ]).then(([dbRows, dbGanttTasks, dbViews]) => {
      setRows(dbRows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        ganttViewId: r.ganttViewId,
        name: r.name,
        color: r.color,
        orderIndex: r.orderIndex,
      })))
      setGanttTasks(dbGanttTasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        rowId: t.rowId || '',
        name: t.name,
        description: t.description || undefined,
        startDate: t.startDate.toISOString(),
        endDate: t.endDate.toISOString(),
        color: t.color,
        progress: t.progress,
        dependencies: [],
        boardTaskId: t.boardTaskId || null,
      })))
      const { setViews, setActiveViewId } = useGanttStore.getState()
      setViews(dbViews.map((v) => ({
        id: v.id,
        projectId: v.projectId,
        name: v.name,
        groupBy: v.groupBy,
        filters: (v.filters ?? {}) as Record<string, unknown>,
      })))
      if (dbViews.length > 0 && !useGanttStore.getState().activeViewId) {
        setActiveViewId(dbViews[0].id)
      }
    }).catch((err) => console.error('Failed to load gantt data:', err))
  }, [activeTab, projectId, isLoading, setGanttTasks, setRows])

  useEffect(() => {
    if (activeTab !== 'canvas' || isLoading) return
    Promise.all([
      getCanvasNodes(projectId),
      getCanvasEdges(projectId),
    ]).then(([dbNodes, dbEdges]) => {
      setCanvasNodes(dbNodes.map((n) => ({
        id: n.id,
        projectId: n.projectId,
        type: n.type,
        positionX: n.positionX,
        positionY: n.positionY,
        name: n.name,
        description: n.description || undefined,
        color: n.color,
      })))
      setCanvasEdges(dbEdges.map((e) => ({
        id: e.id,
        projectId: e.projectId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label || undefined,
        animated: e.animated,
      })))
    }).catch((err) => console.error('Failed to load canvas data:', err))
  }, [activeTab, projectId, isLoading, setCanvasNodes, setCanvasEdges])

  useEffect(() => {
    const POLL_INTERVAL = 30_000
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !useBoardStore.getState().isDirty) {
        setLoadKey((k) => k + 1)
      }
    }, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const triggerReload = () => setLoadKey((k) => k + 1)

  return {
    isLoading,
    loadError,
    triggerReload,
  }
}
