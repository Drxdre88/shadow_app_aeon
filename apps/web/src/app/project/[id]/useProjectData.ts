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
import { useAvatarPrefsStore } from '@/components/board/sizing'
import { useBoardFreshness } from './useBoardFreshness'

const PUSHER_DEBOUNCE_MS = 300

type AssigneeLite = { userId: string; name: string | null; email?: string | null; image: string | null; initials?: string | null; color?: string | null; textColor?: string | null; shape?: string | null }
type RealmAvatars = { preferInitials: boolean }
type VirtualAssigneeLite = { virtualMemberId: string; name: string; initials: string; color: string }
type VirtualMemberRaw = { id: string; name: string; initials: string; color: string }
type AssigneePill = AssigneeLite & { initials?: string | null; kind?: 'virtual'; color?: string | null }

// Real + virtual assignees merge into one pill list per task — virtual pills
// reuse the userId slot for their member id (uuids never collide) and carry
// kind/color so avatars render the dashed initials style.
function toAssigneePills(
  raw: Record<string, AssigneeLite[]> | undefined,
  rawVirtual?: Record<string, VirtualAssigneeLite[]>,
): Record<string, AssigneePill[]> {
  const out: Record<string, AssigneePill[]> = {}
  if (raw) {
    for (const [taskId, list] of Object.entries(raw)) {
      out[taskId] = list.map((a) => ({
        userId: a.userId,
        name: a.name,
        email: a.email ?? null,
        // Realm overrides — null means "derive", so an un-styled member is
        // byte-identical to what this mapper produced before overrides existed.
        initials: a.initials ?? null,
        color: a.color ?? null,
        textColor: a.textColor ?? null,
        shape: a.shape ?? null,
        image: a.image,
      }))
    }
  }
  if (rawVirtual) {
    for (const [taskId, list] of Object.entries(rawVirtual)) {
      const target = out[taskId] ?? (out[taskId] = [])
      for (const v of list) {
        target.push({ userId: v.virtualMemberId, name: v.name, initials: v.initials, image: null, kind: 'virtual', color: v.color })
      }
    }
  }
  return out
}

function toVirtualMemberLites(raw: VirtualMemberRaw[] | undefined) {
  return (raw ?? []).map((v) => ({ id: v.id, name: v.name, initials: v.initials, color: v.color }))
}

export function useProjectData(projectId: string, activeTab: 'board' | 'gantt' | 'canvas' | 'trophy' | 'velocity', initialBoardData?: Record<string, unknown>) {
  const [isLoading, setIsLoading] = useState(!initialBoardData)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isInitialLoad = useRef(true)

  const { setTasks: setGanttTasks, setRows } = useGanttStore()
  const { setNodes: setCanvasNodes, setEdges: setCanvasEdges } = useCanvasStore()

  const fetchIdRef = useRef(0)
  const knownVersionRef = useRef<number | null>(null)
  const recheckSoonRef = useRef<() => void>(() => {})
  const activeProjectRef = useRef<string | null>(projectId)
  const loadInFlightRef = useRef(false)

  const doFullLoad = useCallback(() => {
    const currentFetchId = ++fetchIdRef.current
    loadInFlightRef.current = true

    loadBoardData(projectId)
      .then(({ boardVersion, tasks: dbTasks, columns: dbColumns, labels: dbLabels, taskLabels: dbTaskLabels, dependencies: dbDependencies, checklistSummaries: dbChecklistSummaries, checklistPreviews: dbChecklistPreviews, assignees: dbAssignees, virtualAssignees: dbVirtualAssignees, virtualMembers: dbVirtualMembers, realmAvatars }) => {
        if (currentFetchId !== fetchIdRef.current) return
        loadInFlightRef.current = false
        if (activeProjectRef.current !== projectId) return
        // Realm policy is not board state, so it lands even when the board is
        // dirty — nothing the user is typing can conflict with it.
        useAvatarPrefsStore.getState().setRealmPreferInitials(realmAvatars?.preferInitials === true)
        if (!isInitialLoad.current && isDirtyOrGracePeriod()) {
          recheckSoonRef.current()
          return
        }
        knownVersionRef.current = boardVersion ?? null

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
            metadata: (t.metadata as Record<string, unknown> | null) ?? {},
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
          assigneesByTask: toAssigneePills(dbAssignees, dbVirtualAssignees),
          virtualMembers: toVirtualMemberLites(dbVirtualMembers),
          isDirty: false,
        })

        setIsLoading(false)
        isInitialLoad.current = false
      })
      .catch((err) => {
        if (currentFetchId === fetchIdRef.current) loadInFlightRef.current = false
        console.error('Failed to load project data:', err)
        if (isInitialLoad.current) {
          setLoadError('Failed to load project data. Check your connection and try again.')
          setIsLoading(false)
          isInitialLoad.current = false
        }
      })
  }, [projectId])

  const initialDataRef = useRef(initialBoardData)

  // A load or check still in flight when the user leaves this board must not
  // paint its cards over the next one (the board store is global).
  useEffect(() => {
    activeProjectRef.current = projectId
    return () => {
      activeProjectRef.current = null
      loadInFlightRef.current = false
    }
  }, [projectId])

  useEffect(() => {
    const cachedTasks = useBoardStore.getState().tasks
    const hasCachedProject = cachedTasks.length > 0 && cachedTasks[0]?.projectId === projectId

    isInitialLoad.current = true
    knownVersionRef.current = null
    // Module-global, so a previous realm's policy must not linger while this
    // project (possibly in another realm) loads.
    useAvatarPrefsStore.getState().setRealmPreferInitials(false)

    if (!hasCachedProject && !initialDataRef.current) {
      setIsLoading(true)
      useBoardStore.setState({ tasks: [], columns: [], labels: [], dependencies: [], checklistSummaries: {}, checklistPreviews: {} })
    }
    setLoadError(null)
    setGanttTasks([])
    setRows([])

    if (initialDataRef.current) {
      const data = initialDataRef.current as { boardVersion?: number; tasks: Array<Record<string, unknown>>; columns: Array<Record<string, unknown>>; labels: Array<Record<string, unknown>>; taskLabels: Array<{ taskId: string; labelId: string }>; dependencies: Array<Record<string, unknown>>; checklistSummaries: Record<string, never>; checklistPreviews: Record<string, never[]>; assignees?: Record<string, AssigneeLite[]>; virtualAssignees?: Record<string, VirtualAssigneeLite[]>; virtualMembers?: VirtualMemberRaw[]; realmAvatars?: RealmAvatars }
      initialDataRef.current = undefined
      knownVersionRef.current = typeof data.boardVersion === 'number' ? data.boardVersion : null
      useAvatarPrefsStore.getState().setRealmPreferInitials(data.realmAvatars?.preferInitials === true)

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
        assigneesByTask: toAssigneePills(data.assignees, data.virtualAssignees),
        virtualMembers: toVirtualMemberLites(data.virtualMembers),
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

  const requestReload = useCallback(() => {
    if (loadInFlightRef.current) return
    doFullLoad()
  }, [doFullLoad])
  const { checkNow, recheckSoon } = useBoardFreshness(projectId, knownVersionRef, requestReload)
  const checkNowRef = useRef(checkNow)
  useEffect(() => {
    recheckSoonRef.current = recheckSoon
    checkNowRef.current = checkNow
  }, [recheckSoon, checkNow])

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
    // Events sent while the socket was down (sleep, network drop) are never
    // replayed, so every (re)connect re-checks the board version.
    pusher.connection.bind('connected', () => void checkNowRef.current())

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
      if (isDirtyOrGracePeriod()) {
        recheckSoonRef.current()
        return
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        doFullLoad()
      }, PUSHER_DEBOUNCE_MS)
    })

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      channel.unbind_all()
      pusher.connection.unbind('connected')
      pusher.unsubscribe(`board-${projectId}`)
      pusher.disconnect()
      pusherRef.current = null
    }
  }, [projectId, doFullLoad])

  const triggerReload = useCallback(() => {
    doFullLoad()
  }, [doFullLoad])

  return {
    isLoading,
    loadError,
    triggerReload,
  }
}
