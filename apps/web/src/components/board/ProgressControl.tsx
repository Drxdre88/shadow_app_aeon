'use client'

import { cn } from '@/lib/utils/cn'
import { progressHue } from './progressColor'

interface ProgressControlProps {
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  autoFocus?: boolean
  className?: string
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

// Slider + numeric pair shared by the 'p' popover and the card edit modal so
// both write progress the same way.
export function ProgressControl({ value, onChange, onCommit, autoFocus, className }: ProgressControlProps) {
  const hue = progressHue(value)

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        onKeyUp={() => onCommit?.(value)}
        className="flex-1 min-w-0 cursor-pointer"
        style={{ accentColor: `hsl(${hue}, 85%, 55%)` }}
      />
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        onBlur={() => onCommit?.(value)}
        className={cn(
          'w-14 px-1.5 py-1 rounded-md text-xs text-right tabular-nums',
          'bg-white/5 border border-white/10 text-white',
          'focus:outline-none focus:ring-1 focus:ring-white/25'
        )}
      />
    </div>
  )
}
