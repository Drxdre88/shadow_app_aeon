'use client'

import { motion, AnimatePresence } from 'framer-motion'
import {
  SlidersHorizontal,
  History,
  Clock,
  Tag,
  Flag,
  LayoutGrid,
  Table2,
  ChevronDown,
  BarChart3,
} from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { resolvePriority } from '@/lib/utils/priorities'
import { cn } from '@/lib/utils/cn'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { formatCount } from './trophy-stats'
import { SEGMENT_BUTTON_CLASS, useChartMotion } from './trophy-chart-kit'
import type { ViewMode, DateGranularity } from './trophy-utils'

export type DisplayMode = 'gallery' | 'table'
export type SortMode = 'newest' | 'oldest' | 'priority' | 'name'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const GROUP_MODES: { mode: ViewMode; icon: typeof Clock; label: string }[] = [
  { mode: 'timeline', icon: Clock, label: 'Timeline' },
  { mode: 'priority', icon: Flag, label: 'Priority' },
  { mode: 'label', icon: Tag, label: 'Label' },
]

const DISPLAY_MODES: { mode: DisplayMode; icon: typeof LayoutGrid; label: string }[] = [
  { mode: 'gallery', icon: LayoutGrid, label: 'Gallery' },
  { mode: 'table', icon: Table2, label: 'Table' },
]

const PILL_CLASS =
  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60'

interface TrophyControlsProps {
  displayMode: DisplayMode
  onDisplayMode: (mode: DisplayMode) => void
  viewMode: ViewMode
  onViewMode: (mode: ViewMode) => void
  dateGranularity: DateGranularity
  onDateGranularity: (g: DateGranularity) => void
  sortMode: SortMode
  onSortMode: (mode: SortMode) => void
  priorityFilter: string
  onPriorityFilter: (id: string) => void
  filtersOpen: boolean
  onToggleFilters: () => void
  insightsOpen: boolean
  onToggleInsights: () => void
  drawerOpen: boolean
  onToggleDrawer: () => void
  shown: number
  total: number
}

export function TrophyControls({
  displayMode,
  onDisplayMode,
  viewMode,
  onViewMode,
  dateGranularity,
  onDateGranularity,
  sortMode,
  onSortMode,
  priorityFilter,
  onPriorityFilter,
  filtersOpen,
  onToggleFilters,
  insightsOpen,
  onToggleInsights,
  drawerOpen,
  onToggleDrawer,
  shown,
  total,
}: TrophyControlsProps) {
  const { colors, priorities } = useThemeStore()
  const animate = useChartMotion()
  const gold = goldText(colors.isDark)
  const hasActiveFilters = sortMode !== 'newest' || priorityFilter !== 'all'

  const segmentStyle = (active: boolean): React.CSSProperties =>
    active ? { background: hexAlpha(GOLD.base, 0.16), color: gold } : { color: colors.textDim }

  const pillStyle = (active: boolean): React.CSSProperties => ({
    background: active ? hexAlpha(GOLD.base, 0.12) : colors.surface,
    borderColor: active ? hexAlpha(GOLD.base, 0.4) : colors.border,
    color: active ? gold : colors.textMuted,
  })

  const groupStyle: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}` }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <div role="group" aria-label="Display" className="flex items-center rounded-lg p-0.5" style={groupStyle}>
          {DISPLAY_MODES.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              type="button"
              aria-pressed={displayMode === mode}
              onClick={() => onDisplayMode(mode)}
              className={cn(SEGMENT_BUTTON_CLASS, 'flex items-center gap-1.5 px-3 py-1')}
              style={segmentStyle(displayMode === mode)}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {displayMode === 'gallery' && (
          <>
            <div role="group" aria-label="Group by" className="flex items-center rounded-lg p-0.5" style={groupStyle}>
              {GROUP_MODES.map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => onViewMode(mode)}
                  className={cn(SEGMENT_BUTTON_CLASS, 'flex items-center gap-1.5 px-3 py-1')}
                  style={segmentStyle(viewMode === mode)}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {viewMode === 'timeline' && (
              <div role="group" aria-label="Granularity" className="flex items-center rounded-lg p-0.5" style={groupStyle}>
                {(['day', 'week', 'month'] as DateGranularity[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={dateGranularity === g}
                    onClick={() => onDateGranularity(g)}
                    className={cn(SEGMENT_BUTTON_CLASS, 'px-2.5 py-1')}
                    style={segmentStyle(dateGranularity === g)}
                  >
                    {cap(g)}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={onToggleFilters}
              className={PILL_CLASS}
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

        <button type="button" aria-pressed={insightsOpen} onClick={onToggleInsights} className={PILL_CLASS} style={pillStyle(insightsOpen)}>
          <BarChart3 className="w-3.5 h-3.5" />
          Insights
        </button>

        <button type="button" aria-pressed={drawerOpen} onClick={onToggleDrawer} className={PILL_CLASS} style={pillStyle(drawerOpen)}>
          <History className="w-3.5 h-3.5" />
          Activity
        </button>

        <span className="text-[10px] tabular-nums" style={{ color: colors.textDim }}>
          {formatCount(shown)}/{formatCount(total)}
        </span>
      </div>

      <AnimatePresence initial={false}>
        {filtersOpen && displayMode === 'gallery' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: animate ? 0.15 : 0 }}
            className="overflow-hidden -mt-1"
          >
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-lg border flex-wrap"
              style={{ background: colors.surface, borderColor: colors.border }}
            >
              <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: colors.textDim }}>
                Sort
              </span>
              {(['newest', 'oldest', 'priority', 'name'] as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={sortMode === mode}
                  onClick={() => onSortMode(mode)}
                  className={cn(SEGMENT_BUTTON_CLASS, 'px-2.5 py-0.5')}
                  style={segmentStyle(sortMode === mode)}
                >
                  {cap(mode)}
                </button>
              ))}

              <div className="w-px h-4" style={{ background: colors.border }} />

              <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: colors.textDim }}>
                Priority
              </span>
              {['all', ...[...priorities].reverse().map((pr) => pr.id)].map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={priorityFilter === p}
                  onClick={() => onPriorityFilter(p)}
                  className={cn(SEGMENT_BUTTON_CLASS, 'px-2.5 py-0.5')}
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
    </>
  )
}
