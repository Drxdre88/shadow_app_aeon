'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { useGanttStore } from '@/lib/store/ganttStore'

type TimeScale = 'day' | 'week' | 'month'

const scales: { value: TimeScale; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function TimeScaleSelector() {
  const { timeScale, setTimeScale } = useGanttStore()

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-white/5 backdrop-blur-xl border border-white/10">
      {scales.map((scale) => {
        const isActive = timeScale === scale.value
        return (
          <button
            key={scale.value}
            onClick={() => setTimeScale(scale.value)}
            className={cn(
              'relative px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200',
              isActive
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'
            )}
          >
            {isActive && (
              <motion.div
                layoutId="timeScaleActiveTab"
                className="absolute inset-0 rounded-md"
                style={{
                  background: 'linear-gradient(to bottom, color-mix(in srgb, var(--primary) 30%, transparent), color-mix(in srgb, var(--primary) 10%, transparent))',
                  border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
                  boxShadow: '0 0 20px 5px var(--glow-color)',
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              />
            )}
            <span className="relative z-10">{scale.label}</span>
          </button>
        )
      })}
    </div>
  )
}
