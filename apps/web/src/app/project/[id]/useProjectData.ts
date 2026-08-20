'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import PusherClient from 'pusher-js'
import { loadBoardData } from '@/lib/actions/board'
import { getRows, getGanttTasks } from '@/lib/actions/gantt'
import { getGanttViews } from '@/lib/actions/ganttViews'
import { getCanvasNodes, getCanvasEdges } from '@/lib/actions/canvas'
import { useBoardStore, isDirtyOrGracePeriod } from '@/lib/store/boardStore'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useCanvasStore } from '@/lib/store/canvasStore'

const POLL_INTERVAL = 30_000
const PUSHER_DEBOUNCE_MS = 300

type AssigneeLite = { userId: string; name: string | null; image: string | null }
function toAssigneePills(raw: Record<string, AssigneeLite[]> | undefined): Record<string, AssigneeLite[]> {
  const out: Record<string, AssigneeLite[]> = {}
  if (!raw) return out
  for (const [taskId, list] of Object.entries(raw)) {
    out[taskId] = list.map((a) => ({ userId: a.userId, name: a.name, image: a.image }))
  }
  return out
}

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

export function useProjectData(projectId: string, activeTab: 'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity', initialBoardData?: Record<string, unknown>) {
  const [isLoading, setIsLoading] = useState(!initialBoardData)
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
      .then(({ tasks: dbTasks, columns: dbColumns, labels: dbLabels, taskLabels: dbTaskLabels, dependencies: dbDependencies, checklistSummaries: dbChecklistSummaries, checklistPreviews: dbChecklistPreviews, assignees: dbAssignees }) => {
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
            progress: t.progress ?? null,
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
          assigneesByTask: toAssigneePills(dbAssignees),
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

  const initialDataRef = useRef(initialBoardData)

  useEffect(() => {
    const cachedTasks = useBoardStore.getState().tasks
    const hasCachedProject = cachedTasks.length > 0 && cachedTasks[0]?.projectId === projectId

    isInitialLoad.current = true
    knownVersionRef.current = null

    if (!hasCachedProject && !initialDataRef.current) {
      setIsLoading(true)
      useBoardStore.setState({ tasks: [], columns: [], labels: [], dependencies: [], checklistSummaries: {}, checklistPreviews: {} })
    }
    setLoadError(null)
    setGanttTasks([])
    setRows([])

    if (initialDataRef.current) {
      const data = initialDataRef.current as { tasks: Array<Record<string, unknown>>; columns: Array<Record<string, unknown>>; labels: Array<Record<string, unknown>>; taskLabels: Array<{ taskId: string; labelId: string }>; dependencies: Array<Record<string, unknown>>; checklistSummaries: Record<string, never>; checklistPreviews: Record<string, never[]>; assignees?: Record<string, AssigneeLite[]> }
      initialDataRef.current = undefined

      const taskLabelMap = new Map<string, string[]>()
      data.taskLabels.forEach((tl) => {
        const existing = taskLabelMap.get(tl.taskId) || []
        existing.push(tl.labelId)
        taskLabelMap.set(tl.taskId, existing)
      })

      const firstColumnId = (data.columns[0] as { id?: string })?.id
      const columnByOldStatus = new Map<string, string>()
      for (const col of data.columns) {
        const c = col as { id: string; name: string }
        const lower = c.name.toLowerCase()
        if (lower === 'todo') columnByOldStatus.set('todo', c.id)
        else if (lower === 'doing') columnByOldStatus.set('doing', c.id)
        else if (lower === 'review') columnByOldStatus.set('review', c.id)
        else if (lower === 'done') columnByOldStatus.set('done', c.id)
      }

      useBoardStore.setState({
        columns: data.columns as never[],
        tasks: (data.tasks as Array<Record<string, unknown>>).map((t) => ({
          ...t,
          columnId: (t.columnId as string) || columnByOldStatus.get(t.status as string) || firstColumnId,
          description: (t.description as string) || undefined,
          labels: taskLabelMap.get(t.id as string) || [],
          startDate: t.startDate ? (t.startDate as Date).toISOString?.() ?? t.startDate : undefined,
          endDate: t.endDate ? (t.endDate as Date).toISOString?.() ?? t.endDate : undefined,
          updatedAt: t.updatedAt ? (t.updatedAt as Date).toISOString?.() ?? t.updatedAt : undefined,
          size: (t.size as number) ?? null,
          progress: (t.progress as number) ?? null,
          ganttTaskId: (t.ganttTaskId as string) ?? null,
        })) as never[],
        labels: data.labels as never[],
        dependencies: data.dependencies as never[],
        checklistSummaries: data.checklistSummaries,
        checklistPreviews: data.checklistPreviews,
        assigneesByTask: toAssigneePills(data.assignees),
        isDirty: false,
      })

      setIsLoading(false)
      isInitialLoad.current = false
    } else {
      doFullLoad()
    }
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

  const pusherRef = useRef<PusherClient | null>(null)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    if (!key || !cluster) return

    if (pusherRef.current) {
      pusherRef.current.unsubscribe(`board-${projectId}`)
      pusherRef.current.disconnect()
    }

    const pusher = new PusherClient(key, { cluster })
    pusherRef.current = pusher
    const channel = pusher.subscribe(`board-${projectId}`)

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    channel.bind('board-update', (payload?: { type?: string }) => {
      // A peer's comment changes nothing the board payload carries, so it only
      // signals the open card's thread to refresh. Reloading the whole board
      // for every comment would be pure waste. Version drift still triggers a
      // full reload on the next poll, which is fine.
      if (payload?.type === 'comment:changed') {
        useBoardStore.getState().bumpCommentsSignal()
        return
      }
      if (isDirtyOrGracePeriod()) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        knownVersionRef.current = null
        doFullLoad()
      }, PUSHER_DEBOUNCE_MS)
    })

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      channel.unbind_all()
      pusher.unsubscribe(`board-${projectId}`)
      pusher.disconnect()
      pusherRef.current = null
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
