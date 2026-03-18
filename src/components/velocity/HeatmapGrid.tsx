'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'

interface HeatmapGridProps {
  data: { dayOfWeek: number; hourOfDay: number; count: number }[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DISPLAY_HOURS = [0, 4, 8, 12, 16, 20]

function intensityColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return 'rgba(255,255,255,0.03)'
  const ratio = count / maxCount
  if (ratio < 0.25) return 'rgba(245,158,11,0.15)'
  if (ratio < 0.5) return 'rgba(245,158,11,0.3)'
  if (ratio < 0.75) return 'rgba(245,158,11,0.5)'
  return 'rgba(245,158,11,0.75)'
}

export function HeatmapGrid({ data }: HeatmapGridProps) {
  const { grid, maxCount } = useMemo(() => {
    const g: Record<string, number> = {}
    let mc = 0
    for (const d of data) {
      const key = `${d.dayOfWeek}-${d.hourOfDay}`
      g[key] = (g[key] ?? 0) + d.count
      mc = Math.max(mc, g[key])
    }
    return { grid: g, maxCount: mc }
  }, [data])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4"
    >
      <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">
        Activity Heatmap
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
          No activity data
        </div>
      ) : (
        <div className="flex gap-1">
          <div className="flex flex-col gap-1 pr-1 pt-5">
            {DAYS.map((day) => (
              <div key={day} className="h-[22px] flex items-center text-[10px] text-slate-500 leading-none">
                {day}
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-x-auto">
            <div className="flex gap-[2px] mb-1">
              {DISPLAY_HOURS.map((h) => (
                <div
                  key={h}
                  className="text-[9px] text-slate-500 text-center"
                  style={{ width: `${100 / DISPLAY_HOURS.length}%` }}
                >
                  {h.toString().padStart(2, '0')}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {DAYS.map((_, dayIdx) => (
                <div key={dayIdx} className="flex gap-[2px]">
                  {HOURS.map((hour) => {
                    const count = grid[`${dayIdx}-${hour}`] ?? 0
                    return (
                      <div
                        key={hour}
                        className="flex-1 h-[22px] rounded-sm transition-colors"
                        style={{ backgroundColor: intensityColor(count, maxCount) }}
                        title={`${DAYS[dayIdx]} ${hour}:00 - ${count} completions`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
