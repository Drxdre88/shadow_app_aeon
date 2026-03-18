'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Filter, SortAsc } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { getActivityFeed } from '@/lib/actions/activity'
import { getVaultTasks, getVaultStatsSA, restoreVaultTask } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'
import { TrophyCard } from './TrophyCard'
import { TrophyStats } from './TrophyStats'
import { TrophyTimeline } from './TrophyTimeline'
import { cn } from '@/lib/utils/cn'
import type { ActivityEvent, TaskVault } from '@/lib/db/schema'

interface TrophyRoomProps {
  projectId: string
}

type SortMode = 'newest' | 'oldest' | 'priority' | 'name'
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'urgent'

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 }

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

const TIMELINE_PAGE_SIZE = 30

export function TrophyRoom({ projectId }: TrophyRoomProps) {
  const { glowIntensity } = useThemeStore()

  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [timelineEvents, setTimelineEvents] = useState<ActivityEvent[]>([])
  const [timelineCursor, setTimelineCursor] = useState<string | undefined>(undefined)
  const [hasMoreEvents, setHasMoreEvents] = useState(false)
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false)
  const [vaultTasks, setVaultTasks] = useState<TaskVault[]>([])
  const [vaultStats, setVaultStats] = useState<{
    total: number
    avgDays: number | null
    byPriority: Record<string, number>
    thisWeek: number
  } | null>(null)
  const [isLoadingVault, setIsLoadingVault] = useState(true)

  const handleRestore = useCallback(async (vaultId: string) => {
    const vt = vaultTasks.find(t => t.id === vaultId)
    if (!vt) return
    try {
      const restored = await restoreVaultTask(vaultId, projectId)
      if (restored) {
        setVaultTasks(prev => prev.filter(t => t.id !== vaultId))
        if (vaultStats) {
          setVaultStats({ ...vaultStats, total: vaultStats.total - 1 })
        }
        const { addTask } = useBoardStore.getState()
        addTask({
          id: restored.id,
          projectId: restored.projectId,
          name: restored.name,
          description: restored.description || undefined,
          columnId: restored.columnId || undefined,
          status: restored.status,
          priority: restored.priority as 'low' | 'medium' | 'high' | 'urgent',
          color: restored.color,
          labels: [],
          onTimeline: restored.onTimeline,
          size: restored.size ?? null,
          orderIndex: restored.orderIndex,
        })
      }
    } catch (err) {
      console.error('Failed to restore from vault:', err)
    }
  }, [projectId, vaultTasks, vaultStats])

  useEffect(() => {
    setIsLoadingVault(true)
    Promise.all([
      getVaultTasks(projectId),
      getVaultStatsSA(projectId),
    ]).then(([tasks, stats]) => {
      setVaultTasks(tasks)
      setVaultStats(stats)
    }).catch(() => {}).finally(() => setIsLoadingVault(false))
  }, [projectId])

  const loadInitialTimeline = useCallback(async () => {
    setIsLoadingTimeline(true)
    try {
      const results = await getActivityFeed(projectId, { limit: TIMELINE_PAGE_SIZE })
      setTimelineEvents(results)
      setHasMoreEvents(results.length === TIMELINE_PAGE_SIZE)
      if (results.length > 0) {
        setTimelineCursor(new Date(results[results.length - 1].createdAt).toISOString())
      }
    } finally {
      setIsLoadingTimeline(false)
    }
  }, [projectId])

  const loadMoreTimeline = useCallback(async () => {
    if (!hasMoreEvents || isLoadingTimeline) return
    setIsLoadingTimeline(true)
    try {
      const results = await getActivityFeed(projectId, {
        limit: TIMELINE_PAGE_SIZE,
        cursor: timelineCursor,
      })
      setTimelineEvents((prev) => [...prev, ...results])
      setHasMoreEvents(results.length === TIMELINE_PAGE_SIZE)
      if (results.length > 0) {
        setTimelineCursor(new Date(results[results.length - 1].createdAt).toISOString())
      }
    } finally {
      setIsLoadingTimeline(false)
    }
  }, [projectId, timelineCursor, hasMoreEvents, isLoadingTimeline])

  useEffect(() => {
    loadInitialTimeline()
  }, [loadInitialTimeline])

  const filteredAndSorted = useMemo(() => {
    let result = [...vaultTasks]
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter)
    }
    result.sort((a, b) => {
      if (sortMode === 'newest') {
        return new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime()
      }
      if (sortMode === 'oldest') {
        return new Date(a.archivedAt).getTime() - new Date(b.archivedAt).getTime()
      }
      if (sortMode === 'priority') {
        return (priorityRank[a.priority as keyof typeof priorityRank] ?? 2) - (priorityRank[b.priority as keyof typeof priorityRank] ?? 2)
      }
      return a.name.localeCompare(b.name)
    })
    return result
  }, [vaultTasks, sortMode, priorityFilter])

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-hidden">
      <TrophyStats
        totalCompleted={vaultStats?.total ?? 0}
        byPriority={vaultStats?.byPriority ?? {}}
        completedThisWeek={vaultStats?.thisWeek ?? 0}
        avgCompletionDays={vaultStats?.avgDays ?? null}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <SortAsc className="w-3.5 h-3.5" />
          <span>Sort</span>
        </div>
        {(['newest', 'oldest', 'priority', 'name'] as SortMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setSortMode(mode)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
              sortMode === mode
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
            )}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}

        <div className="w-px h-4 bg-white/10 mx-1" />

        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Priority</span>
        </div>
        {(['all', 'urgent', 'high', 'medium', 'low'] as PriorityFilter[]).map((p) => (
          <button
            key={p}
            onClick={() => setPriorityFilter(p)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
              priorityFilter === p
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
            )}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}

        <span className="ml-auto text-xs text-slate-500">
          {filteredAndSorted.length} / {vaultStats?.total ?? 0} trophies
        </span>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <div className="flex-[3] min-h-0 overflow-y-auto">
          {isLoadingVault ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              Loading vault...
            </div>
          ) : filteredAndSorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3 py-20">
              <div
                className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center"
                style={glowIntensity > 0 ? { boxShadow: `0 0 ${20 * (glowIntensity / 75)}px rgba(16,185,129,0.15)` } : undefined}
              >
                <Trophy className="w-7 h-7 opacity-30" />
              </div>
              <p className="text-sm">No trophies yet</p>
              <p className="text-xs text-slate-600">Complete tasks and send them to the vault</p>
            </div>
          ) : (
            <motion.div
              className="grid grid-cols-2 xl:grid-cols-3 gap-3 pb-4"
              variants={containerVariants}
              initial="hidden"
              animate="show"
            >
              <AnimatePresence>
                {filteredAndSorted.map((vt) => (
                  <TrophyCard
                    key={vt.id}
                    vaultTask={vt}
                    onRestore={handleRestore}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        <div className="flex-[2] min-h-0">
          <TrophyTimeline
            projectId={projectId}
            events={timelineEvents}
            onLoadMore={loadMoreTimeline}
            hasMore={hasMoreEvents}
            isLoading={isLoadingTimeline}
          />
        </div>
      </div>
    </div>
  )
}
