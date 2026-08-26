'use client'

import { memo, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { resolveAccentHex } from '@/lib/utils/colors'
import { resolvePriority } from '@/lib/utils/priorities'
import { cn } from '@/lib/utils/cn'
import {
  bucketByPeriod,
  breakdownByLabel,
  breakdownByPriority,
  breakdownByColumn,
  type TrophyDatum,
  type ChartGranularity,
  type BreakdownRow,
} from './trophy-stats'
import { GOLD, goldText, hexAlpha } from './trophy-theme'

// ---------------------------------------------------------------------------
// Completion-over-time chart (inline SVG, gold family, direct labels)
// ---------------------------------------------------------------------------

const CHART_W = 640
const CHART_H = 180
const PAD = { top: 24, right: 8, bottom: 22, left: 8 }

interface CompletionChartProps {
  tasks: TrophyDatum[]
}

function CompletionChart({ tasks }: CompletionChartProps) {
  const { colors } = useThemeStore()
  const [granularity, setGranularity] = useState<ChartGranularity>('week')
  const gold = goldText(colors.isDark)

  const buckets = useMemo(
    () => bucketByPeriod(tasks, granularity, granularity === 'week' ? 12 : 12),
    [tasks, granularity]
  )

  const max = Math.max(...buckets.map((b) => b.count), 1)
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const slot = innerW / buckets.length
  const barW = Math.min(slot * 0.55, 34)

  const labelEvery = buckets.length > 8 ? 2 : 1

  return (
    <div
      className="rounded-2xl p-4 backdrop-blur-xl flex flex-col"
      style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: colors.textDim }}>
          Trophies over time
        </span>
        <div className="flex items-center rounded-lg p-0.5" style={{ border: `1px solid ${colors.border}` }}>
          {(['week', 'month'] as ChartGranularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize transition-colors duration-200"
              style={
                granularity === g
                  ? { background: hexAlpha(GOLD.base, 0.16), color: gold }
                  : { color: colors.textDim }
              }
            >
              {g === 'week' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label="Trophies completed over time">
        <defs>
          <linearGradient id="trophyBarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD.bright} stopOpacity={colors.isDark ? 0.95 : 0.9} />
            <stop offset="100%" stopColor={GOLD.deep} stopOpacity={colors.isDark ? 0.55 : 0.65} />
          </linearGradient>
        </defs>

        {/* baseline */}
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={CHART_W - PAD.right}
          y2={PAD.top + innerH}
          stroke={colors.border}
        />

        {buckets.map((b, i) => {
          const h = b.count === 0 ? 0 : Math.max((b.count / max) * innerH, 3)
          const cx = PAD.left + slot * i + slot / 2
          const x = cx - barW / 2
          const y = PAD.top + innerH - h
          return (
            <g key={b.key}>
              {b.count > 0 && (
                <motion.rect
                  x={x}
                  width={barW}
                  rx={Math.min(5, barW / 2)}
                  fill="url(#trophyBarFill)"
                  initial={{ y: PAD.top + innerH, height: 0 }}
                  animate={{ y, height: h }}
                  transition={{ type: 'spring', stiffness: 220, damping: 26, delay: i * 0.035 }}
                >
                  <title>{`${b.label}: ${b.count}`}</title>
                </motion.rect>
              )}
              {b.count > 0 && (
                <motion.text
                  x={cx}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill={gold}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.25 + i * 0.035 }}
                >
                  {b.count}
                </motion.text>
              )}
              {i % labelEvery === 0 && (
                <text
                  x={cx}
                  y={CHART_H - 6}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill={colors.textDim}
                >
                  {b.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

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
  const gold = goldText(colors.isDark)
  const max = Math.max(...rows.map((r) => r.count), 1)

  return (
    <div
      className="rounded-2xl p-4 backdrop-blur-xl min-w-0"
      style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
    >
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: colors.textDim }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs py-4 text-center" style={{ color: colors.textDim }}>
          Nothing here yet
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, i) => {
            const resolved = variant === 'priority' ? resolvePriority(priorities, row.key) : null
            const barColor = resolved
              ? resolved.color
              : row.key === 'unlabeled'
                ? colors.textDim
                : gold
            const displayLabel = resolved ? resolved.name : row.label
            return (
              <div key={row.key} className="group">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 text-xs truncate min-w-0" style={{ color: colors.textMuted }}>
                    {variant === 'gold' && row.color && (
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: labelDotColor(row, gold) }}
                      />
                    )}
                    <span className={cn('truncate', variant === 'priority' && 'capitalize')}>{displayLabel}</span>
                  </span>
                  <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: colors.text }}>
                    {row.count}
                    <span className="font-normal ml-1" style={{ color: colors.textDim }}>
                      {Math.round(row.share * 100)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: hexAlpha(barColor, 0.12) }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: barColor }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(row.count / max) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 200, damping: 28, delay: i * 0.05 }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
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
  const byLabel = useMemo(() => breakdownByLabel(tasks, 5), [tasks])
  const byPriority = useMemo(() => breakdownByPriority(tasks), [tasks])
  const byColumn = useMemo(() => breakdownByColumn(tasks, 5), [tasks])

  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-3 gap-3', className)}>
      <div className="lg:col-span-2 min-w-0">
        <CompletionChart tasks={tasks} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3 min-w-0">
        <BreakdownPanel title="By priority" rows={byPriority} variant="priority" />
        <BreakdownPanel title="By label" rows={byLabel} variant="gold" />
        <BreakdownPanel title="From column" rows={byColumn} variant="gold" />
      </div>
    </div>
  )
})
