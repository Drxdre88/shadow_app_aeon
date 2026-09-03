'use client'

import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { resolveAccentHex } from '@/lib/utils/colors'
import { resolvePriority } from '@/lib/utils/priorities'
import { cn } from '@/lib/utils/cn'
import {
  breakdownByLabel,
  breakdownByPriority,
  breakdownByColumn,
  formatCount,
  NO_PRIORITY_KEY,
  type TrophyDatum,
  type BreakdownRow,
} from './trophy-stats'
import { goldText, hexAlpha } from './trophy-theme'
import { ChartCard, ChartEmpty, useChartMotion } from './trophy-chart-kit'
import { TrophyCompletionChart } from './TrophyCompletionChart'
import { TrophyCycleTimeChart } from './TrophyCycleTimeChart'
import { TrophyRhythmHeatmap } from './TrophyRhythmHeatmap'

// ---------------------------------------------------------------------------
// Breakdown panels — thin horizontal bars, one hue family + neutrals
// ---------------------------------------------------------------------------

interface BreakdownPanelProps {
  title: string
  rows: BreakdownRow[]
  /** 'gold' bars, or per-row warm priority colors. */
  variant: 'gold' | 'priority'
}

function labelDotColor(row: BreakdownRow, fallback: string): string {
  return resolveAccentHex(row.color, fallback)
}

function BreakdownPanel({ title, rows, variant }: BreakdownPanelProps) {
  const { colors, priorities } = useThemeStore()
  const animate = useChartMotion()
  const gold = goldText(colors.isDark)
  const max = Math.max(...rows.map((r) => r.count), 1)

  const resolvedRows = rows.map((row) => {
    // Sentinel buckets ("Unlabeled", "No priority") aren't real levels
    // or labels — they stay neutral rather than being resolved.
    const isNeutral = row.key === 'unlabeled' || row.key === NO_PRIORITY_KEY
    const resolved = variant === 'priority' && !isNeutral ? resolvePriority(priorities, row.key) : null
    return {
      row,
      barColor: resolved ? resolved.color : isNeutral ? colors.textDim : gold,
      displayLabel: resolved ? resolved.name : row.label,
    }
  })

  const summary =
    rows.length === 0
      ? `${title}: nothing yet.`
      : `${title}: ${resolvedRows.map(({ row, displayLabel }) => `${displayLabel} ${row.count} (${Math.round(row.share * 100)}%)`).join(', ')}.`

  return (
    <ChartCard title={title} summary={summary}>
      {rows.length === 0 ? (
        <ChartEmpty>Nothing here yet</ChartEmpty>
      ) : (
        <div className="space-y-2">
          {resolvedRows.map(({ row, barColor, displayLabel }, i) => (
            <div key={row.key} className="group">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="flex items-center gap-1.5 text-xs truncate min-w-0" style={{ color: colors.textMuted }}>
                  {variant === 'gold' && row.color && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: labelDotColor(row, gold) }} />
                  )}
                  <span className={cn('truncate', variant === 'priority' && 'capitalize')}>{displayLabel}</span>
                </span>
                <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: colors.text }}>
                  {formatCount(row.count)}
                  <span className="font-normal ml-1" style={{ color: colors.textDim }}>
                    {Math.round(row.share * 100)}%
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: hexAlpha(barColor, 0.12) }}>
                <motion.div
                  className="h-full rounded-full group-hover:brightness-110"
                  style={{ background: barColor }}
                  initial={animate ? { width: 0 } : false}
                  animate={{ width: `${(row.count / max) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 200, damping: 28, delay: i * 0.05 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------
// Insights band
// ---------------------------------------------------------------------------

interface TrophyInsightsProps {
  tasks: TrophyDatum[]
  className?: string
}

export const TrophyInsights = memo(function TrophyInsights({ tasks, className }: TrophyInsightsProps) {
  const { priorities } = useThemeStore()
  // Configured ids highest level first — the aggregation buckets by raw id and
  // this decides the display order, so custom levels get their own honest row.
  const priorityOrder = useMemo(() => [...priorities].reverse().map((p) => p.id), [priorities])

  const byLabel = useMemo(() => breakdownByLabel(tasks, 5), [tasks])
  const byPriority = useMemo(() => breakdownByPriority(tasks, priorityOrder), [tasks, priorityOrder])
  const byColumn = useMemo(() => breakdownByColumn(tasks, 5), [tasks])

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 min-w-0 grid">
          <TrophyCompletionChart tasks={tasks} />
        </div>
        <TrophyCycleTimeChart tasks={tasks} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <TrophyRhythmHeatmap tasks={tasks} />
        <BreakdownPanel title="By priority" rows={byPriority} variant="priority" />
        <BreakdownPanel title="By label" rows={byLabel} variant="gold" />
        <BreakdownPanel title="From column" rows={byColumn} variant="gold" />
      </div>
    </div>
  )
})
