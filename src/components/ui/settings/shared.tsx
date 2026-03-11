'use client'

import { motion } from 'framer-motion'
import { type Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function GlowSlider({
  value,
  onChange,
  themeColor,
  label,
  icon: Icon,
}: {
  value: number
  onChange: (v: number) => void
  themeColor: string
  label: string
  icon: typeof Sparkles
}) {
  const glowOpacity = value / 100

  return (
    <div className="relative py-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon
            className="w-4 h-4 transition-all duration-300"
            style={{
              color: themeColor,
              filter: `drop-shadow(0 0 ${8 * glowOpacity}px ${themeColor})`,
            }}
          />
          <span className="text-xs font-medium text-slate-300">{label}</span>
        </div>
        <span
          className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded"
          style={{ color: themeColor, backgroundColor: `${themeColor}20` }}
        >
          {value}%
        </span>
      </div>

      <div className="relative h-5 flex items-center max-w-[280px]">
        <div className="absolute inset-x-0 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${value}%`,
              background: `linear-gradient(90deg, ${themeColor}60, ${themeColor})`,
              boxShadow: `0 0 ${12 * glowOpacity}px ${3 * glowOpacity}px ${themeColor}`,
            }}
          />
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer z-10"
        />
        <div
          className="absolute w-3 h-3 rounded-full border border-white/40 pointer-events-none"
          style={{
            left: `calc(${value}% - 6px)`,
            background: `radial-gradient(circle at 30% 30%, white, ${themeColor})`,
            boxShadow: `0 0 ${8 * glowOpacity}px ${3 * glowOpacity}px ${themeColor}`,
          }}
        />
      </div>
    </div>
  )
}

export function ToggleRow({ label, value, onChange, color }: { label: string; value: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center gap-3 px-1 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
    >
      <div
        className="w-9 h-[20px] rounded-full transition-all duration-200 flex items-center px-0.5 flex-shrink-0"
        style={{
          background: value ? color : 'rgba(255,255,255,0.1)',
          boxShadow: value ? `0 0 8px ${color}60` : 'none',
          justifyContent: value ? 'flex-end' : 'flex-start',
          display: 'flex',
        }}
      >
        <motion.div className="w-4 h-4 rounded-full bg-white" layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      </div>
      <span className={cn('text-xs font-medium transition-colors', value ? 'text-slate-200' : 'text-slate-500')}>{label}</span>
    </button>
  )
}

export function CompactSlider({ label, value, onChange, min, max, color, unit = 'px', step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; color: string; unit?: string; step?: number
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="space-y-1 max-w-[280px]">
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 min-w-[90px]">{label}</span>
        <span className="text-xs font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}20` }}>
          {value}{unit}
        </span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer z-10"
        />
        <div
          className="absolute w-3 h-3 rounded-full border border-white/40 pointer-events-none"
          style={{ left: `calc(${pct}% - 6px)`, background: `radial-gradient(circle at 30% 30%, white, ${color})` }}
        />
      </div>
    </div>
  )
}
