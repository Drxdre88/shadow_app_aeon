'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trophy,
  SlidersHorizontal,
  History,
  Clock,
  Tag,
  Flag,
  LayoutGrid,
  Table2,
  X,
  ChevronDown,
} from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { getActivityFeed } from '@/lib/actions/activity'
import { getVaultTasks, getVaultStatsSA, restoreVaultTask } from '@/lib/actions/vault'
import { useBoardStore } from '@/lib/store/boardStore'
import { TrophyCard } from './TrophyCard'
import { TrophyHero } from './TrophyHero'
import { TrophyInsights } from './TrophyInsights'
import { TrophyTable } from './TrophyTable'
import { TrophyTimeline } from './TrophyTimeline'
import { TrophySection } from './TrophySection'
import {
  groupByTimeline,
  groupByPriority,
  groupByLabel,
  type ViewMode,
  type DateGranularity,
} from './trophy-utils'
import { computeStreak, monthComparison, sumSize, trophyDate } from './trophy-stats'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { resolvePriority } from '@/lib/utils/priorities'
import { TrophyDetailModal } from './TrophyDetailModal'
import { cn } from '@/lib/utils/cn'
import type { ActivityEvent, TaskVault } from '@/lib/db/schema'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface TrophyRoomProps {
  projectId: string
}

type DisplayMode = 'gallery' | 'table'
type SortMode = 'newest' | 'oldest' | 'priority' | 'name'
// Priority filter values are the user's configured priority ids (plus 'all') —
// custom levels are filterable just like the factory four.

const TIMELINE_PAGE_SIZE = 30

const GROUP_MODES: { mode: ViewMode; icon: typeof Clock; label: string }[] = [
  { mode: 'timeline', icon: Clock, label: 'Timeline' },
  { mode: 'priority', icon: Flag, label: 'Priority' },
  { mode: 'label', icon: Tag, label: 'Label' },
]

export function TrophyRoom({ projectId }: TrophyRoomProps) {
  const { colors, glowIntensity, priorities } = useThemeStore()
  const mult = glowIntensity / 75
  const gold = goldText(colors.isDark)

  const [displayMode, setDisplayMode] = useState<DisplayMode>('gallery')
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [dateGranularity, setDateGranularity] = useState<DateGranularity>('month')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
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

  // Derived hero stats (client-side, from the loaded vault window)
  const weekStreak = useMemo(() => computeStreak(vaultTasks, 'week'), [vaultTasks])
  const months = useMemo(() => monthComparison(vaultTasks), [vaultTasks])
  const effortBanked = useMemo(() => sumSize(vaultTasks), [vaultTasks])

  // Rank follows the user's configured priority order (low -> urgent),
  // so custom levels sort correctly too; unknown ids sink to the bottom.
  const priorityRank = useMemo(() => {
    const m = new Map<string, number>()
    priorities.forEach((p, i) => m.set(p.id, i))
    return m
  }, [priorities])

  const filteredAndSorted = useMemo(() => {
    let result = [...vaultTasks]
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter)
    }
    result.sort((a, b) => {
      if (sortMode === 'newest') return trophyDate(b).getTime() - trophyDate(a).getTime()
      if (sortMode === 'oldest') return trophyDate(a).getTime() - trophyDate(b).getTime()
      if (sortMode === 'priority')
        return (priorityRank.get(b.priority) ?? -1) - (priorityRank.get(a.priority) ?? -1)
      return a.name.localeCompare(b.name)
    })
    return result
  }, [vaultTasks, sortMode, priorityFilter, priorityRank])

  const sections = useMemo(() => {
    if (viewMode === 'timeline') return groupByTimeline(filteredAndSorted, dateGranularity)
    if (viewMode === 'priority') return groupByPriority(filteredAndSorted)
    return groupByLabel(filteredAndSorted)
  }, [filteredAndSorted, viewMode, dateGranularity])

  const hasActiveFilters = sortMode !== 'newest' || priorityFilter !== 'all'

  const segmentStyle = (active: boolean): React.CSSProperties =>
    active
      ? { background: hexAlpha(GOLD.base, 0.16), color: gold }
      : { color: colors.textDim }

  const pillStyle = (active: boolean): React.CSSProperties => ({
    background: active ? hexAlpha(GOLD.base, 0.12) : colors.surface,
    borderColor: active ? hexAlpha(GOLD.base, 0.4) : colors.border,
    color: active ? gold : colors.textMuted,
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 p-4 pb-8 max-w-[1440px] mx-auto">
        <TrophyHero
          total={vaultStats?.total ?? 0}
          thisWeek={vaultStats?.thisWeek ?? 0}
          avgDays={vaultStats?.avgDays ?? null}
          weekStreak={weekStreak}
          months={months}
          effortBanked={effortBanked}
        />

        {!isLoadingVault && vaultTasks.length > 0 && <TrophyInsights tasks={vaultTasks} />}

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center rounded-lg p-0.5"
            style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
          >
            {([
              { mode: 'gallery' as DisplayMode, icon: LayoutGrid, label: 'Gallery' },
              { mode: 'table' as DisplayMode, icon: Table2, label: 'Table' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setDisplayMode(mode)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors duration-200"
                style={segmentStyle(displayMode === mode)}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {displayMode === 'gallery' && (
            <>
              <div
                className="flex items-center rounded-lg p-0.5"
                style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
              >
                {GROUP_MODES.map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors duration-200"
                    style={segmentStyle(viewMode === mode)}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {viewMode === 'timeline' && (
                <div
                  className="flex items-center rounded-lg p-0.5"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
                >
                  {(['day', 'week', 'month'] as DateGranularity[]).map((g) => (
                    <button
                      key={g}
                      onClick={() => setDateGranularity(g)}
                      className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors duration-200"
                      style={segmentStyle(dateGranularity === g)}
                    >
                      {cap(g)}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => setFiltersOpen((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-200"
                style={pillStyle(hasActiveFilters || filtersOpen)}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Filters
                {hasActiveFilters && <div className="w-1.5 h-1.5 rounded-full" style={{ background: gold }} />}
                <ChevronDown className={cn('w-3 h-3 transition-transform', filtersOpen && 'rotate-180')} />
              </button>
            </>
          )}

          <div className="flex-1" />

          <button
            onClick={() => setDrawerOpen((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-200"
            style={pillStyle(drawerOpen)}
          >
            <History className="w-3.5 h-3.5" />
            Activity
          </button>

          <span className="text-[10px] tabular-nums" style={{ color: colors.textDim }}>
            {filteredAndSorted.length}/{vaultStats?.total ?? 0}
          </span>
        </div>

        <AnimatePresence>
          {filtersOpen && displayMode === 'gallery' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden -mt-1"
            >
              <div
                className="flex items-center gap-3 px-3 py-2 rounded-lg border flex-wrap"
                style={{ background: colors.surface, borderColor: colors.border }}
              >
                <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: colors.textDim }}>Sort</span>
                {(['newest', 'oldest', 'priority', 'name'] as SortMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSortMode(mode)}
                    className="px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors duration-200"
                    style={segmentStyle(sortMode === mode)}
                  >
                    {cap(mode)}
                  </button>
                ))}

                <div className="w-px h-4" style={{ background: colors.border }} />

                <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: colors.textDim }}>Priority</span>
                {['all', ...[...priorities].reverse().map((pr) => pr.id)].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriorityFilter(p)}
                    className="px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors duration-200"
                    style={
                      priorityFilter === p
                        ? p === 'all'
                          ? segmentStyle(true)
                          : {
                              background: hexAlpha(resolvePriority(priorities, p).color, 0.14),
                              color: resolvePriority(priorities, p).color,
                            }
                        : { color: colors.textDim }
                    }
                  >
                    {p === 'all' ? 'All' : resolvePriority(priorities, p).name}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content */}
        {isLoadingVault ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl animate-pulse" style={{ background: colors.surfaceHover }} />
            ))}
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24" style={{ color: colors.textDim }}>
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: `linear-gradient(140deg, ${hexAlpha(GOLD.bright, 0.18)}, ${hexAlpha(GOLD.deep, 0.12)})`,
                border: `1px solid ${hexAlpha(GOLD.base, 0.35)}`,
                boxShadow: glowIntensity > 0 ? `0 0 ${24 * mult}px ${4 * mult}px ${GOLD.glow}` : undefined,
              }}
            >
              <Trophy className="w-7 h-7" style={{ color: gold }} />
            </div>
            <p className="text-sm font-medium" style={{ color: colors.textMuted }}>The vault awaits its first trophy</p>
            <p className="text-xs">Complete tasks and send them here to build your collection</p>
          </div>
        ) : displayMode === 'table' ? (
          <TrophyTable tasks={filteredAndSorted} onRestore={handleRestore} onSelect={setSelectedTrophy} />
        ) : viewMode === 'priority' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col min-h-0">
                <div
                  className="flex items-center gap-2 px-2 py-1.5 mb-2 border-b"
                  style={{ borderColor: hexAlpha(resolvePriority(priorities, section.key).color, 0.35) }}
                >
                  <span className="text-sm font-medium capitalize" style={{ color: resolvePriority(priorities, section.key).color }}>
                    {resolvePriority(priorities, section.key).name}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: colors.textDim }}>{section.tasks.length}</span>
                </div>
                <div className="space-y-2 px-1">
                  {section.tasks.map((vt) => (
                    <TrophyCard key={vt.id} vaultTask={vt} onRestore={handleRestore} onClick={setSelectedTrophy} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
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
                <span className="text-sm font-semibold" style={{ color: colors.text }}>Activity Timeline</span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 rounded-lg transition-colors hover:bg-white/[0.06]"
                  style={{ color: colors.textMuted }}
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
