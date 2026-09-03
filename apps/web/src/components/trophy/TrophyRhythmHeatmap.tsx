'use client'

import { memo, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '@/stores/themeStore'
import { completionHeatmap, formatCount, formatHour, WEEKDAY_LABELS, type TrophyDatum } from './trophy-stats'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { ChartCard, ChartEmpty, useChartMotion, useChartTooltip } from './trophy-chart-kit'

const CELL = 12
const GAP = 2
const PITCH = CELL + GAP
const LEFT = 28
const TOP = 14
const W = LEFT + 24 * PITCH
const H = TOP + 7 * PITCH
const HOUR_TICKS = [0, 6, 12, 18]

interface TrophyRhythmHeatmapProps {
  tasks: TrophyDatum[]
}

export const TrophyRhythmHeatmap = memo(function TrophyRhythmHeatmap({ tasks }: TrophyRhythmHeatmapProps) {
  const colors = useThemeStore((s) => s.colors)
  const animate = useChartMotion()
  const { frameRef, tooltip, showFor, hide } = useChartTooltip()
  const [hovered, setHovered] = useState<string | null>(null)
  const gold = goldText(colors.isDark)

  const heat = useMemo(() => completionHeatmap(tasks), [tasks])
  const { cells, max, total, peak } = heat

  const peakText = peak ? `${WEEKDAY_LABELS[peak.day]} ${formatHour(peak.hour)}` : null
  // Trophies can exist without a single parseable date: total > 0, peak null.
  const summary =
    total === 0
      ? 'No completions recorded yet.'
      : peak
        ? `When trophies land, by weekday and hour: ${formatCount(total)} trophies, busiest ${peakText} with ${peak.count}.`
        : `${formatCount(total)} trophies, none with a usable completion date.`

  const emptyFill = hexAlpha(colors.text, colors.isDark ? 0.06 : 0.05)
  const fillFor = (count: number) => (count === 0 ? emptyFill : hexAlpha(gold, 0.22 + 0.73 * (count / max)))

  const meta =
    peakText ? (
      <span className="text-[10px]" style={{ color: colors.textDim }}>
        peak <span className="font-semibold" style={{ color: colors.text }}>{peakText}</span>
      </span>
    ) : undefined

  return (
    <ChartCard title="When trophies land" meta={meta} summary={summary} tooltip={tooltip} frameRef={frameRef}>
      {total === 0 ? (
        <ChartEmpty>Your finishing rhythm shows up here once the first trophies land.</ChartEmpty>
      ) : !peak ? (
        <ChartEmpty>These trophies carry no usable completion dates, so there is no rhythm to draw yet.</ChartEmpty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label={summary}>
          {HOUR_TICKS.map((h) => (
            <text key={h} x={LEFT + h * PITCH + CELL / 2} y={TOP - 4} textAnchor="middle" fontSize="8.5" fill={colors.textDim}>
              {formatHour(h)}
            </text>
          ))}
          {WEEKDAY_LABELS.map((d, row) => (
            <text key={d} x={LEFT - 6} y={TOP + row * PITCH + CELL - 2} textAnchor="end" fontSize="8.5" fill={colors.textDim}>
              {d}
            </text>
          ))}
          <motion.g initial={animate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
            {cells.map((row, day) =>
              row.map((count, hour) => {
                const key = `${day}-${hour}`
                const isHot = hovered === key
                const title = `${WEEKDAY_LABELS[day]} ${formatHour(hour)}`
                const line = `${count} ${count === 1 ? 'trophy' : 'trophies'}`
                return (
                  <rect
                    key={key}
                    x={LEFT + hour * PITCH}
                    y={TOP + day * PITCH}
                    width={CELL}
                    height={CELL}
                    rx={2.5}
                    fill={fillFor(count)}
                    stroke={isHot ? gold : 'none'}
                    strokeWidth={isHot ? 1.5 : 0}
                    style={{ transition: 'fill 150ms' }}
                    onPointerEnter={(e) => {
                      setHovered(key)
                      showFor(e.currentTarget, title, [line])
                    }}
                    onPointerLeave={() => {
                      setHovered(null)
                      hide()
                    }}
                  >
                    <title>{`${title}: ${line}`}</title>
                  </rect>
                )
              })
            )}
          </motion.g>
          {peak && (
            <motion.rect
              x={LEFT + peak.hour * PITCH - 1.5}
              y={TOP + peak.day * PITCH - 1.5}
              width={CELL + 3}
              height={CELL + 3}
              rx={3.5}
              fill="none"
              stroke={GOLD.bright}
              strokeWidth={1.25}
              style={{ pointerEvents: 'none' }}
              initial={animate ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.4 }}
            />
          )}
        </svg>
      )}
    </ChartCard>
  )
})
