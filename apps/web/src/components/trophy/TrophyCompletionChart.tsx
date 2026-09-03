'use client'

import { memo, useId, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import {
  bucketByPeriod,
  rollingMean,
  formatCount,
  type TrophyDatum,
  type ChartGranularity,
} from './trophy-stats'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import {
  ChartCard,
  ChartEmpty,
  ChartLegend,
  SEGMENT_BUTTON_CLASS,
  useChartMotion,
  useChartTooltip,
} from './trophy-chart-kit'

const W = 640
const H = 170
const PAD = { top: 18, right: 10, bottom: 20, left: 8 }

const WINDOWS: Record<
  ChartGranularity,
  { periods: number; window: number; avgLabel: string; labelEvery: number; toggle: string }
> = {
  day: { periods: 56, window: 7, avgLabel: '7-day avg', labelEvery: 7, toggle: 'Days' },
  week: { periods: 12, window: 4, avgLabel: '4-week avg', labelEvery: 2, toggle: 'Weeks' },
  month: { periods: 12, window: 3, avgLabel: '3-month avg', labelEvery: 1, toggle: 'Months' },
}

interface TrophyCompletionChartProps {
  tasks: TrophyDatum[]
}

export const TrophyCompletionChart = memo(function TrophyCompletionChart({ tasks }: TrophyCompletionChartProps) {
  const colors = useThemeStore((s) => s.colors)
  const animate = useChartMotion()
  const { frameRef, tooltip, showFor, hide } = useChartTooltip()
  const [granularity, setGranularity] = useState<ChartGranularity>('week')
  const [hovered, setHovered] = useState<number | null>(null)
  const gold = goldText(colors.isDark)
  const gradientId = `trophyBarFill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const cfg = WINDOWS[granularity]
  const buckets = useMemo(() => bucketByPeriod(tasks, granularity, cfg.periods), [tasks, granularity, cfg.periods])
  const trend = useMemo(() => rollingMean(buckets.map((b) => b.count), cfg.window), [buckets, cfg.window])

  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  const max = Math.max(...buckets.map((b) => b.count), 1)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / buckets.length
  const barW = Math.min(slot - 2, 24)
  const baseline = PAD.top + innerH

  const xOf = (i: number) => PAD.left + slot * i + slot / 2
  const yOf = (v: number) => baseline - (v / max) * innerH

  let peakIdx = -1
  buckets.forEach((b, i) => {
    if (b.count > 0 && (peakIdx < 0 || b.count > buckets[peakIdx].count)) peakIdx = i
  })
  const lastIdx = buckets.length - 1
  const labelled = new Set([peakIdx, buckets[lastIdx]?.count > 0 ? lastIdx : -1])

  const linePath = trend.map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')

  const summary =
    total === 0
      ? `No trophies in the last ${cfg.periods} ${granularity}s.`
      : `${formatCount(total)} trophies over the last ${cfg.periods} ${granularity}s, peaking at ${buckets[peakIdx].count} on ${buckets[peakIdx].label}; ${cfg.avgLabel} now ${trend[lastIdx].toFixed(1)}.`

  const toggle = (
    <div className="flex items-center gap-2">
      <ChartLegend
        items={[
          { label: 'Trophies', kind: 'bar', color: gold },
          { label: cfg.avgLabel, kind: 'line', color: colors.text },
        ]}
      />
      <div className="flex items-center rounded-lg p-0.5" style={{ border: `1px solid ${colors.border}` }}>
        {(Object.keys(WINDOWS) as ChartGranularity[]).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={granularity === g}
            onClick={() => setGranularity(g)}
            className={cn(SEGMENT_BUTTON_CLASS, 'px-2 py-0.5 text-[10px] font-semibold')}
            style={granularity === g ? { background: hexAlpha(GOLD.base, 0.16), color: gold } : { color: colors.textDim }}
          >
            {WINDOWS[g].toggle}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <ChartCard title="Trophies over time" meta={toggle} summary={summary} tooltip={tooltip} frameRef={frameRef}>
      {total === 0 ? (
        <ChartEmpty>Nothing landed in this window yet — vault a finished card and the bars begin.</ChartEmpty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={summary}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD.bright} stopOpacity={colors.isDark ? 0.95 : 0.9} />
              <stop offset="100%" stopColor={GOLD.deep} stopOpacity={colors.isDark ? 0.55 : 0.65} />
            </linearGradient>
          </defs>

          <line x1={PAD.left} y1={baseline} x2={W - PAD.right} y2={baseline} stroke={colors.border} />

          {buckets.map((b, i) => {
            const h = b.count === 0 ? 0 : Math.max((b.count / max) * innerH, 3)
            const cx = xOf(i)
            const y = baseline - h
            const isHot = hovered === i
            const showAxisLabel = i % cfg.labelEvery === 0 || i === lastIdx
            return (
              <g key={b.key}>
                {b.count > 0 && (
                  <motion.rect
                    x={cx - barW / 2}
                    width={barW}
                    rx={Math.min(4, barW / 2)}
                    fill={`url(#${gradientId})`}
                    opacity={hovered === null || isHot ? 1 : 0.55}
                    initial={animate ? { attrY: baseline, height: 0 } : false}
                    animate={{ attrY: y, height: h }}
                    transition={{ type: 'spring', stiffness: 220, damping: 26, delay: i * 0.02 }}
                    style={{ transition: 'opacity 150ms' }}
                  />
                )}
                {labelled.has(i) && b.count > 0 && (
                  <motion.text
                    x={cx}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill={colors.text}
                    initial={animate ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    {formatCount(b.count)}
                  </motion.text>
                )}
                {showAxisLabel && (
                  <text x={cx} y={H - 6} textAnchor="middle" fontSize="9.5" fill={colors.textDim}>
                    {b.label}
                  </text>
                )}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  tabIndex={b.count > 0 ? 0 : -1}
                  aria-label={`${b.label}: ${b.count} trophies, ${cfg.avgLabel} ${trend[i].toFixed(1)}`}
                  className="outline-none"
                  onPointerEnter={(e) => {
                    setHovered(i)
                    showFor(e.currentTarget, b.label, [`${b.count} ${b.count === 1 ? 'trophy' : 'trophies'}`, `${cfg.avgLabel}: ${trend[i].toFixed(1)}`])
                  }}
                  onFocus={(e) => {
                    setHovered(i)
                    showFor(e.currentTarget, b.label, [`${b.count} ${b.count === 1 ? 'trophy' : 'trophies'}`, `${cfg.avgLabel}: ${trend[i].toFixed(1)}`])
                  }}
                  onPointerLeave={() => {
                    setHovered(null)
                    hide()
                  }}
                  onBlur={() => {
                    setHovered(null)
                    hide()
                  }}
                />
              </g>
            )
          })}

          <motion.path
            d={linePath}
            fill="none"
            stroke={colors.text}
            strokeOpacity={0.75}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'none' }}
            initial={animate ? { pathLength: 0, opacity: 0 } : false}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.9, ease: 'easeOut', delay: 0.2 }}
          />
          <motion.circle
            cx={xOf(lastIdx)}
            cy={yOf(trend[lastIdx])}
            fill={colors.text}
            stroke={colors.surface}
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
            initial={animate ? { r: 0, opacity: 0 } : false}
            animate={{ r: 4, opacity: 1 }}
            transition={{ delay: 1, type: 'spring', stiffness: 300, damping: 20 }}
          />
        </svg>
      )}
    </ChartCard>
  )
})
