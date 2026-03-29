'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { VelocityRange } from '@/lib/data/velocity'

interface VelocityChartProps {
  data: { period: string; count: number }[]
  range: VelocityRange
}

const CHART_HEIGHT = 200
const CHART_PADDING = { top: 20, right: 20, bottom: 30, left: 40 }

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

export function VelocityChart({ data, range }: VelocityChartProps) {
  const { points, maxY, yTicks, xLabels, pathD, areaD } = useMemo(() => {
    if (data.length === 0) return { points: [], maxY: 0, yTicks: [], xLabels: [], pathD: '', areaD: '' }

    const max = Math.max(...data.map(d => d.count), 1)
    const roundedMax = Math.ceil(max / 5) * 5 || 5

    const width = 500 - CHART_PADDING.left - CHART_PADDING.right
    const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

    const pts = data.map((d, i) => ({
      x: CHART_PADDING.left + (data.length === 1 ? width / 2 : (i / (data.length - 1)) * width),
      y: CHART_PADDING.top + height - (d.count / roundedMax) * height,
      label: d.period,
      value: d.count,
    }))

    const ticks = [0, Math.round(roundedMax / 2), roundedMax]

    const labels = data.length <= 10
      ? data.map((d, i) => ({ x: pts[i].x, text: formatDateLabel(d.period) }))
      : data.filter((_, i) => i % Math.ceil(data.length / 6) === 0 || i === data.length - 1)
          .map(d => {
            const idx = data.indexOf(d)
            return { x: pts[idx].x, text: formatDateLabel(d.period) }
          })

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    const area = pts.length > 0
      ? `${line} L ${pts[pts.length - 1].x} ${CHART_PADDING.top + height} L ${pts[0].x} ${CHART_PADDING.top + height} Z`
      : ''

    return { points: pts, maxY: roundedMax, yTicks: ticks, xLabels: labels, pathD: line, areaD: area }
  }, [data])

  const height = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Completion Velocity
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          No completions in this range
        </div>
      ) : (
        <svg viewBox="0 0 500 200" className="w-full" style={{ height: CHART_HEIGHT }}>
          {yTicks.map((tick) => {
            const y = CHART_PADDING.top + height - (tick / maxY) * height
            return (
              <g key={tick}>
                <line
                  x1={CHART_PADDING.left}
                  y1={y}
                  x2={500 - CHART_PADDING.right}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="4 4"
                />
                <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="10">
                  {tick}
                </text>
              </g>
            )
          })}

          <defs>
            <linearGradient id="velocityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(245,158,11)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(245,158,11)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {areaD && <path d={areaD} fill="url(#velocityGradient)" />}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="rgb(245,158,11)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="rgb(245,158,11)" stroke="rgba(0,0,0,0.5)" strokeWidth="1">
              <title>{`${p.label}: ${p.value}`}</title>
            </circle>
          ))}

          {xLabels.map((label, i) => (
            <text
              key={i}
              x={label.x}
              y={CHART_HEIGHT - 5}
              textAnchor="middle"
              fill="rgba(255,255,255,0.3)"
              fontSize="9"
            >
              {label.text}
            </text>
          ))}
        </svg>
      )}
    </motion.div>
  )
}
