'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, SortAsc, History, Clock, Tag, LayoutGrid, X, ChevronDown } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { getActivityFeed } from '@/lib/actions/activity'
import { getVaultTasks, getVaultStatsSA, restoreVaultTask } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'
import { TrophyCard } from './TrophyCard'
import { TrophyStats } from './TrophyStats'
import { TrophyTimeline } from './TrophyTimeline'
import { TrophySection } from './TrophySection'
import {
  groupByTimeline,
  groupByPriority,
  groupByLabel,
  type ViewMode,
  type DateGranularity,
} from './trophy-utils'
import { TrophyDetailModal } from './TrophyDetailModal'
import { cn } from '@/lib/utils/cn'
import type { ActivityEvent, TaskVault } from '@/lib/db/schema'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface TrophyRoomProps {
  projectId: string
}

type SortMode = 'newest' | 'oldest' | 'priority' | 'name'
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'urgent'

const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 }

const TIMELINE_PAGE_SIZE = 30

const VIEW_MODES: { mode: ViewMode; icon: typeof Clock; label: string }[] = [
  { mode: 'timeline', icon: Clock, label: 'Timeline' },
  { mode: 'priority', icon: LayoutGrid, label: 'Priority' },
  { mode: 'label', icon: Tag, label: 'Label' },
]

const PRIORITY_LANE_COLORS: Record<string, string> = {
  urgent: 'border-red-500/30',
  high: 'border-orange-500/30',
  medium: 'border-blue-500/30',
  low: 'border-slate-500/30',
}

export function TrophyRoom({ projectId }: TrophyRoomProps) {
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [dateGranularity, setDateGranularity] = useState<DateGranularity>('month')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
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
  const [selectedTrophy, setSelectedTrophy] = useState<TaskVault | null>(null)

  const handleRestore = useCallback(async (vaultId: string) => {
    try {
      const restored = await restoreVaultTask(vaultId, projectId)
      if (restored) {
        setVaultTasks(prev => prev.filter(t => t.id !== vaultId))
        setVaultStats(prev => prev ? { ...prev, total: prev.total - 1 } : prev)
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
  }, [projectId])

  useEffect(() => {
    setIsLoadingVault(true)
    Promise.all([
      getVaultTasks(projectId),
      getVaultStatsSA(projectId),
    ]).then(([tasks, stats]) => {
      setVaultTasks(tasks)
      setVaultStats(stats)
    }).catch((err) => console.error('Failed to load vault:', err)).finally(() => setIsLoadingVault(false))
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
    } catch (err) {
      console.error('Failed to load timeline:', err)
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
    } catch (err) {
      console.error('Failed to load more timeline:', err)
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
    const effectiveTime = (t: typeof vaultTasks[0]) =>
      (t.completedAt ? new Date(t.completedAt) : new Date(t.archivedAt ?? 0)).getTime()
    result.sort((a, b) => {
      if (sortMode === 'newest') return effectiveTime(b) - effectiveTime(a)
      if (sortMode === 'oldest') return effectiveTime(a) - effectiveTime(b)
      if (sortMode === 'priority')
        return (priorityRank[a.priority as keyof typeof priorityRank] ?? 2) - (priorityRank[b.priority as keyof typeof priorityRank] ?? 2)
      return a.name.localeCompare(b.name)
    })
    return result
  }, [vaultTasks, sortMode, priorityFilter])

  const sections = useMemo(() => {
    if (viewMode === 'timeline') return groupByTimeline(filteredAndSorted, dateGranularity)
    if (viewMode === 'priority') return groupByPriority(filteredAndSorted)
    return groupByLabel(filteredAndSorted)
  }, [filteredAndSorted, viewMode, dateGranularity])

  const hasActiveFilters = sortMode !== 'newest' || priorityFilter !== 'all'

  return (
    <div className="flex flex-col gap-3 p-4 h-full overflow-hidden">
      <TrophyStats
        totalCompleted={vaultStats?.total ?? 0}
        byPriority={vaultStats?.byPriority ?? {}}
        completedThisWeek={vaultStats?.thisWeek ?? 0}
        avgCompletionDays={vaultStats?.avgDays ?? null}
      />

      <div className="flex items-center gap-2">
        <div
          className="flex items-center rounded-lg p-0.5"
          style={{ background: `${colors.surface}`, border: `1px solid ${colors.border}` }}
        >
          {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200',
                viewMode === mode ? 'shadow-sm' : 'hover:bg-white/[0.04]'
              )}
              style={
                viewMode === mode
                  ? { background: `${colors.primary}25`, color: colors.primary }
                  : { color: 'rgb(148,163,184)' }
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {viewMode === 'timeline' && (
          <div
            className="flex items-center rounded-lg p-0.5"
            style={{ background: `${colors.surface}`, border: `1px solid ${colors.border}` }}
          >
            {(['day', 'week', 'month'] as DateGranularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setDateGranularity(g)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200"
                style={
                  dateGranularity === g
                    ? { background: 'rgba(255,255,255,0.08)', color: 'rgb(226,232,240)' }
                    : { color: 'rgb(100,116,139)' }
                }
              >
                {cap(g)}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setFiltersOpen((p) => !p)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
          )}
          style={{
            background: hasActiveFilters ? `${colors.primary}15` : colors.surface,
            borderColor: hasActiveFilters ? `${colors.primary}40` : colors.border,
            color: hasActiveFilters ? colors.primary : 'rgb(148,163,184)',
          }}
        >
          <SortAsc className="w-3.5 h-3.5" />
          Filters
          {hasActiveFilters && <div className="w-1.5 h-1.5 rounded-full" style={{ background: colors.primary }} />}
          <ChevronDown className={cn('w-3 h-3 transition-transform', filtersOpen && 'rotate-180')} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200"
          style={{
            background: drawerOpen ? `${colors.primary}15` : colors.surface,
            borderColor: drawerOpen ? `${colors.primary}40` : colors.border,
            color: drawerOpen ? colors.primary : 'rgb(148,163,184)',
          }}
        >
          <History className="w-3.5 h-3.5" />
          Activity
        </button>

        <span className="text-[10px] tabular-nums" style={{ color: 'rgb(100,116,139)' }}>
          {filteredAndSorted.length}/{vaultStats?.total ?? 0}
        </span>
      </div>

      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className="flex items-center gap-4 px-3 py-2 rounded-lg border"
              style={{ background: colors.surface, borderColor: colors.border }}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Sort</div>
              {(['newest', 'oldest', 'priority', 'name'] as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSortMode(mode)}
                  className="px-2.5 py-0.5 rounded-md text-xs font-medium transition-all duration-200"
                  style={
                    sortMode === mode
                      ? { background: `${colors.primary}20`, color: colors.primary }
                      : { color: 'rgb(148,163,184)' }
                  }
                >
                  {cap(mode)}
                </button>
              ))}

              <div className="w-px h-4 bg-white/10" />

              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Priority</div>
              {(['all', 'urgent', 'high', 'medium', 'low'] as PriorityFilter[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPriorityFilter(p)}
                  className="px-2.5 py-0.5 rounded-md text-xs font-medium transition-all duration-200"
                  style={
                    priorityFilter === p
                      ? { background: `${colors.primary}20`, color: colors.primary }
                      : { color: 'rgb(148,163,184)' }
                  }
                >
                  {cap(p)}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 min-h-0 overflow-y-auto relative">
        {isLoadingVault ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-20" style={{ color: 'rgb(100,116,139)' }}>
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: `${colors.primary}10`,
                border: `1px solid ${colors.primary}20`,
                boxShadow: glowIntensity > 0 ? `0 0 ${20 * mult}px ${colors.glowColor}` : undefined,
              }}
            >
              <Trophy className="w-7 h-7 opacity-30" />
            </div>
            <p className="text-sm">No trophies yet</p>
            <p className="text-xs" style={{ color: 'rgb(71,85,105)' }}>Complete tasks and send them to the vault</p>
          </div>
        ) : viewMode === 'priority' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full pb-4">
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col min-h-0">
                <div className={cn(
                  'flex items-center gap-2 px-2 py-1.5 mb-2 border-b',
                  PRIORITY_LANE_COLORS[section.key] ?? 'border-white/[0.06]'
                )}>
                  <span className="text-sm font-medium text-slate-300">{section.label}</span>
                  <span className="text-xs text-slate-600">{section.tasks.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 px-1">
                  {section.tasks.map((vt) => (
                    <TrophyCard key={vt.id} vaultTask={vt} onRestore={handleRestore} onClick={setSelectedTrophy} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pb-4">
            {sections.map((section, idx) => (
              <TrophySection
                key={section.key}
                label={section.label}
                tasks={section.tasks}
                onRestore={handleRestore}
                onCardClick={setSelectedTrophy}
                defaultExpanded={idx < 3}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 right-0 h-full w-[400px] max-w-[90vw] z-50 flex flex-col shadow-2xl"
              style={{
                background: colors.background,
                borderLeft: `1px solid ${colors.border}`,
              }}
            >
              <div className="flex items-center justify-between p-4" style={{ borderBottom: `1px solid ${colors.border}` }}>
                <span className="text-sm font-semibold text-white">Activity Timeline</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <TrophyTimeline
                  projectId={projectId}
                  events={timelineEvents}
                  onLoadMore={loadMoreTimeline}
                  hasMore={hasMoreEvents}
                  isLoading={isLoadingTimeline}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {selectedTrophy && createPortal(
        <TrophyDetailModal
          vaultTask={selectedTrophy}
          onClose={() => setSelectedTrophy(null)}
          onRestore={handleRestore}
        />,
        document.body
      )}
    </div>
  )
}
