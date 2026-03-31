'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { loadBoardData } from '@/lib/actions/board'
import { getRows, getGanttTasks } from '@/lib/actions/gantt'
import { getGanttViews } from '@/lib/actions/ganttViews'
import { getCanvasNodes, getCanvasEdges } from '@/lib/actions/canvas'
import { useBoardStore, isDirtyOrGracePeriod } from '@/lib/store/boardStore'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useCanvasStore } from '@/lib/store/canvasStore'

const POLL_INTERVAL = 5_000

async function fetchBoardVersion(projectId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/sync/version/${projectId}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.version ?? null
  } catch {
    return null
  }
}

export function useProjectData(projectId: string, activeTab: 'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity') {
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isInitialLoad = useRef(true)

  const { setTasks: setGanttTasks, setRows } = useGanttStore()
  const { setNodes: setCanvasNodes, setEdges: setCanvasEdges } = useCanvasStore()

  const fetchIdRef = useRef(0)
  const knownVersionRef = useRef<number | null>(null)
  const pollingRef = useRef(false)

  const doFullLoad = useCallback(() => {
    const currentFetchId = ++fetchIdRef.current

    loadBoardData(projectId)
      .then(({ tasks: dbTasks, columns: dbColumns, labels: dbLabels, taskLabels: dbTaskLabels, dependencies: dbDependencies, checklistSummaries: dbChecklistSummaries, checklistPreviews: dbChecklistPreviews }) => {
        if (currentFetchId !== fetchIdRef.current) return
        if (!isInitialLoad.current && isDirtyOrGracePeriod()) return

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
          checklistPreviews: dbChecklistPreviews,
          isDirty: false,
        })

        setIsLoading(false)
        isInitialLoad.current = false
      })
      .catch((err) => {
        console.error('Failed to load project data:', err)
        if (isInitialLoad.current) {
          setLoadError('Failed to load project data. Check your connection and try again.')
          setIsLoading(false)
          isInitialLoad.current = false
        }
      })
  }, [projectId])

  useEffect(() => {
    const cachedTasks = useBoardStore.getState().tasks
    const hasCachedProject = cachedTasks.length > 0 && cachedTasks[0]?.projectId === projectId

    isInitialLoad.current = true
    knownVersionRef.current = null

    if (!hasCachedProject) {
      setIsLoading(true)
      useBoardStore.setState({ columns: [], labels: [], dependencies: [] })
      useBoardStore.getState().clearCrossedTasks()
    }
    setLoadError(null)
    setGanttTasks([])
    setRows([])

    doFullLoad()
  }, [projectId, doFullLoad, setGanttTasks, setRows])

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
    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      if (isDirtyOrGracePeriod()) return
      if (pollingRef.current) return
      pollingRef.current = true

      try {
        const serverVersion = await fetchBoardVersion(projectId)
        if (serverVersion === null) return

        if (knownVersionRef.current === null) {
          knownVersionRef.current = serverVersion
          return
        }

        if (serverVersion !== knownVersionRef.current) {
          knownVersionRef.current = serverVersion
          doFullLoad()
        }
      } finally {
        pollingRef.current = false
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        poll()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [projectId, doFullLoad])

  const triggerReload = useCallback(() => {
    knownVersionRef.current = null
    doFullLoad()
  }, [doFullLoad])

  return {
    isLoading,
    loadError,
    triggerReload,
  }
}
