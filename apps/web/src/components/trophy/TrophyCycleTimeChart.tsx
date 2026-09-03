'use client'

import { memo, useId, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { cycleTimeDistribution, formatCount, formatDays, type TrophyDatum } from './trophy-stats'
import { GOLD, goldText } from './trophy-theme'
import { ChartCard, ChartEmpty, useChartMotion, useChartTooltip } from './trophy-chart-kit'

const W = 320
const H = 150
const PAD = { top: 18, right: 8, bottom: 20, left: 8 }

interface TrophyCycleTimeChartProps {
  tasks: TrophyDatum[]
}

export const TrophyCycleTimeChart = memo(function TrophyCycleTimeChart({ tasks }: TrophyCycleTimeChartProps) {
  const colors = useThemeStore((s) => s.colors)
  const animate = useChartMotion()
  const { frameRef, tooltip, showFor, hide } = useChartTooltip()
  const [hovered, setHovered] = useState<number | null>(null)
  const gold = goldText(colors.isDark)
  const gradientId = `trophyCycleFill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const dist = useMemo(() => cycleTimeDistribution(tasks), [tasks])
  const { buckets, sample, median, p90 } = dist

  const max = Math.max(...buckets.map((b) => b.count), 1)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / buckets.length
  const barW = Math.min(slot - 4, 24)
  const baseline = PAD.top + innerH

  let peakIdx = -1
  buckets.forEach((b, i) => {
    if (b.count > 0 && (peakIdx < 0 || b.count > buckets[peakIdx].count)) peakIdx = i
  })

  const summary =
    sample === 0
      ? 'No cycle-time data yet.'
      : `Cycle time across ${formatCount(sample)} trophies: median ${formatDays(median)}, 90th percentile ${formatDays(p90)}; most common bucket ${buckets[peakIdx].label} with ${buckets[peakIdx].count}.`

  const meta =
    sample > 0 ? (
      <span className="flex items-center gap-2 text-[10px] tabular-nums" style={{ color: colors.textDim }}>
        <span>
          median <span className="font-semibold" style={{ color: colors.text }}>{formatDays(median)}</span>
        </span>
        <span>
          p90 <span className="font-semibold" style={{ color: colors.text }}>{formatDays(p90)}</span>
        </span>
      </span>
    ) : undefined

  return (
    <ChartCard title="Cycle time" meta={meta} summary={summary} tooltip={tooltip} frameRef={frameRef}>
      {sample === 0 ? (
        <ChartEmpty>Cycle time appears once trophies record how long they took from creation to done.</ChartEmpty>
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
            const cx = PAD.left + slot * i + slot / 2
            const y = baseline - h
            const share = Math.round((b.count / sample) * 100)
            const isHot = hovered === i
            const label = `${b.count} ${b.count === 1 ? 'trophy' : 'trophies'} · ${share}%`
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
                    transition={{ type: 'spring', stiffness: 220, damping: 26, delay: i * 0.05 }}
                    style={{ transition: 'opacity 150ms' }}
                  />
                )}
                {i === peakIdx && (
                  <motion.text
                    x={cx}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill={colors.text}
                    initial={animate ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.35 }}
                  >
                    {formatCount(b.count)}
                  </motion.text>
                )}
                <text x={cx} y={H - 6} textAnchor="middle" fontSize="9.5" fill={isHot ? gold : colors.textDim}>
                  {b.label}
                </text>
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  tabIndex={b.count > 0 ? 0 : -1}
                  aria-label={`${b.label}: ${label}`}
                  className="outline-none"
                  onPointerEnter={(e) => {
                    setHovered(i)
                    showFor(e.currentTarget, b.label, [label])
                  }}
                  onFocus={(e) => {
                    setHovered(i)
                    showFor(e.currentTarget, b.label, [label])
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
        </svg>
      )}
    </ChartCard>
  )
})
