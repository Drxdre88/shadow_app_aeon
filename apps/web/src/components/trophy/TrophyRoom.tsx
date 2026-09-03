'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, X } from 'lucide-react'
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
import { TrophyControls, type DisplayMode, type SortMode } from './TrophyControls'
import { useChartMotion } from './trophy-chart-kit'
import {
  groupByTimeline,
  groupByPriority,
  groupByLabel,
  type ViewMode,
  type DateGranularity,
} from './trophy-utils'
import {
  comparePriority,
  computeStreak,
  countSince,
  monthComparison,
  priorityRankMap,
  sumSize,
  trophyDate,
  NO_PRIORITY_KEY,
} from './trophy-stats'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { resolvePriority } from '@/lib/utils/priorities'
import { TrophyDetailModal } from './TrophyDetailModal'
import type { ActivityEvent, TaskVault } from '@/lib/db/schema'

interface TrophyRoomProps {
  projectId: string
}
// Priority filter values are the user's configured priority ids (plus 'all') —
// custom levels are filterable just like the factory four.

const TIMELINE_PAGE_SIZE = 30

const lastVisitKey = (projectId: string) => `aeon:trophy:last-visit:${projectId}`

function readLastVisit(projectId: string): Date | null {
  try {
    const raw = localStorage.getItem(lastVisitKey(projectId))
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

function writeLastVisit(projectId: string) {
  try {
    localStorage.setItem(lastVisitKey(projectId), new Date().toISOString())
  } catch {
    /* storage unavailable — the chip simply stays hidden */
  }
}

export function TrophyRoom({ projectId }: TrophyRoomProps) {
  const { colors, glowIntensity, priorities } = useThemeStore()
  const animate = useChartMotion()
  const mult = glowIntensity / 75
  const gold = goldText(colors.isDark)

  const [displayMode, setDisplayMode] = useState<DisplayMode>('gallery')
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [dateGranularity, setDateGranularity] = useState<DateGranularity>('month')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(true)
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
  const [sinceLastVisit, setSinceLastVisit] = useState<number | null>(null)
  // Read once per mount, before the load effect can rewrite the key: under
  // StrictMode's doubled effects the second run would otherwise read the
  // timestamp the first run just wrote and count zero.
  const [lastVisit] = useState(() => readLastVisit(projectId))
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
      setSinceLastVisit(lastVisit ? countSince(tasks, lastVisit) : null)
      writeLastVisit(projectId)
    }).catch((err) => console.error('Failed to load vault:', err)).finally(() => setIsLoadingVault(false))
  }, [projectId, lastVisit])

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
  // Shared with TrophyTable so both surfaces rank identically.
  const priorityRank = useMemo(() => priorityRankMap(priorities), [priorities])

  // Configured ids, highest level first — the display order for priority
  // grouping and the insights breakdown.
  const priorityOrder = useMemo(() => [...priorities].reverse().map((p) => p.id), [priorities])

  const filteredAndSorted = useMemo(() => {
    let result = [...vaultTasks]
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter)
    }
    result.sort((a, b) => {
      if (sortMode === 'newest') return trophyDate(b).getTime() - trophyDate(a).getTime()
      if (sortMode === 'oldest') return trophyDate(a).getTime() - trophyDate(b).getTime()
      if (sortMode === 'priority') return comparePriority(b.priority, a.priority, priorityRank)
      return a.name.localeCompare(b.name)
    })
    return result
  }, [vaultTasks, sortMode, priorityFilter, priorityRank])

  const sections = useMemo(() => {
    if (viewMode === 'timeline') return groupByTimeline(filteredAndSorted, dateGranularity)
    if (viewMode === 'priority') return groupByPriority(filteredAndSorted, priorityOrder)
    return groupByLabel(filteredAndSorted)
  }, [filteredAndSorted, viewMode, dateGranularity, priorityOrder])

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-3 p-3 sm:p-4 pb-8 max-w-[1440px] mx-auto">
        <TrophyHero
          total={vaultStats?.total ?? 0}
          thisWeek={vaultStats?.thisWeek ?? 0}
          avgDays={vaultStats?.avgDays ?? null}
          weekStreak={weekStreak}
          months={months}
          effortBanked={effortBanked}
          sinceLastVisit={sinceLastVisit}
        />

        <TrophyControls
          displayMode={displayMode}
          onDisplayMode={setDisplayMode}
          viewMode={viewMode}
          onViewMode={setViewMode}
          dateGranularity={dateGranularity}
          onDateGranularity={setDateGranularity}
          sortMode={sortMode}
          onSortMode={setSortMode}
          priorityFilter={priorityFilter}
          onPriorityFilter={setPriorityFilter}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((p) => !p)}
          insightsOpen={insightsOpen}
          onToggleInsights={() => setInsightsOpen((p) => !p)}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((p) => !p)}
          shown={filteredAndSorted.length}
          total={vaultStats?.total ?? 0}
        />

        <AnimatePresence initial={false}>
          {insightsOpen && !isLoadingVault && vaultTasks.length > 0 && (
            <motion.div
              key="insights"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: animate ? 0.2 : 0, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <TrophyInsights tasks={vaultTasks} />
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
          <div className="flex flex-col items-center justify-center gap-3 py-16" style={{ color: colors.textDim }}>
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
          // Columns are `items-start` and each stack is its own grid: TrophyCard
          // is `h-full`, and a percentage height only resolves sanely against a
          // grid row of its own. Stacked in a block inside a stretched cell, every
          // card resolved to the whole stack's height and the layout ran away.
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
            {sections.map((section) => {
              // The "no priority recorded" bucket is not a real level — it keeps
              // its own neutral heading instead of being resolved to a colour.
              const isNone = section.key === NO_PRIORITY_KEY
              const resolved = isNone ? null : resolvePriority(priorities, section.key)
              const headingColor = resolved ? resolved.color : colors.textDim
              return (
                <section key={section.key} aria-label={resolved ? resolved.name : section.label} className="min-w-0">
                  <div
                    className="flex items-center gap-2 px-2 py-1.5 mb-2 border-b"
                    style={{ borderColor: hexAlpha(headingColor, 0.35) }}
                  >
                    <span className="text-sm font-medium capitalize" style={{ color: headingColor }}>
                      {resolved ? resolved.name : section.label}
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: colors.textDim }}>{section.tasks.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 px-1 content-start">
                    {section.tasks.map((vt) => (
                      <TrophyCard key={vt.id} vaultTask={vt} onRestore={handleRestore} onClick={setSelectedTrophy} />
                    ))}
                  </div>
                </section>
              )
            })}
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
                  type="button"
                  aria-label="Close activity"
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 rounded-lg transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
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
