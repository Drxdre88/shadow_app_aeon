'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'

export function ThemeSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  color,
  unit = '%',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  color: string
  unit?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const displayValue = step < 1 ? value.toFixed(1) : String(value)

  const commitDraft = useCallback(() => {
    const parsed = parseFloat(draft)
    if (!isNaN(parsed)) {
      const stepped = Math.round(parsed / step) * step
      const clamped = Math.max(min, Math.min(max, stepped))
      onChange(step < 1 ? parseFloat(clamped.toFixed(1)) : clamped)
    }
    setEditing(false)
  }, [draft, min, max, step, onChange])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select()
    }
  }, [editing])

  return (
    <div className="group py-1">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-slate-400 tracking-wide">{label}</span>

        {editing ? (
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="w-16 h-6 text-center text-[11px] font-bold tabular-nums rounded-md bg-black/40 border outline-none"
            style={{
              color,
              borderColor: color,
              boxShadow: `0 0 12px 2px ${color}40, inset 0 0 8px ${color}20`,
            }}
          />
        ) : (
          <button
            onClick={() => { setDraft(displayValue); setEditing(true) }}
            className="h-6 px-2 rounded-md text-[11px] font-bold tabular-nums border border-transparent transition-all duration-200 hover:border-white/20 cursor-text"
            style={{
              color,
              background: `${color}12`,
              boxShadow: `0 0 8px 1px ${color}18`,
            }}
          >
            {displayValue}{unit}
          </button>
        )}
      </div>

      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-75"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${color}50, ${color})`,
              boxShadow: `0 0 10px 1px ${color}40`,
            }}
          />
        </div>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(step < 1 ? parseFloat(Number(e.target.value).toFixed(1)) : Number(e.target.value))}
          className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer z-10"
        />

        <div
          className="absolute w-3.5 h-3.5 rounded-full border border-white/50 pointer-events-none transition-[left] duration-75"
          style={{
            left: `calc(${pct}% - 7px)`,
            background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.9), ${color})`,
            boxShadow: `0 0 10px 3px ${color}60, 0 0 4px 1px ${color}90`,
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

export const GlowSlider = ThemeSlider
export const CompactSlider = ({
  label, value, onChange, min, max, color, unit = 'px', step = 1,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; color: string; unit?: string; step?: number
}) => (
  <ThemeSlider label={label} value={value} onChange={onChange} min={min} max={max} step={step} color={color} unit={unit} />
)
