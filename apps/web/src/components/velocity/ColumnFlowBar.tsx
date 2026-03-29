'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

interface ColumnFlowBarProps {
  data: { column: string; avgHours: number; count: number }[]
}

const COLUMN_COLORS = [
  'rgb(168,85,247)',
  'rgb(59,130,246)',
  'rgb(6,182,212)',
  'rgb(16,185,129)',
  'rgb(245,158,11)',
  'rgb(239,68,68)',
  'rgb(236,72,153)',
  'rgb(139,92,246)',
]

function formatHours(hours: number): string {
  if (hours < 1) return '<1h'
  if (hours < 24) return `${Math.round(hours)}h`
  const days = Math.round(hours / 24 * 10) / 10
  return `${days}d`
}

export function ColumnFlowBar({ data }: ColumnFlowBarProps) {
  const totalHours = useMemo(() => data.reduce((sum, d) => sum + d.avgHours, 0), [data])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Avg Column Dwell Time
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-16 text-slate-500 text-sm">
          No column transition data yet
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex h-8 rounded-lg overflow-hidden gap-[2px]">
            {data.map((d, i) => {
              const pct = totalHours > 0 ? (d.avgHours / totalHours) * 100 : 0
              if (pct < 1) return null
              return (
                <div
                  key={d.column}
                  className="h-full flex items-center justify-center text-[10px] font-medium text-white/80 transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: COLUMN_COLORS[i % COLUMN_COLORS.length],
                    minWidth: pct > 5 ? undefined : '20px',
                  }}
                  title={`${d.column}: avg ${formatHours(d.avgHours)} (${d.count} transitions)`}
                >
                  {pct > 10 ? d.column : ''}
                </div>
              )
            })}
          </div>

          <div className="flex gap-3 flex-wrap">
            {data.map((d, i) => (
              <div key={d.column} className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: COLUMN_COLORS[i % COLUMN_COLORS.length] }}
                />
                <span className="text-xs text-slate-300">{d.column}</span>
                <span className="text-xs text-slate-500">{formatHours(d.avgHours)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
