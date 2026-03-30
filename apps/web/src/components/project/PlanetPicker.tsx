'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface PlanetPickerProps {
  value: string
  onChange: (filename: string) => void
}

const ROW_SIZE = 6
const PLANETS = Array.from({ length: 55 }, (_, i) => `planet${i + 1}.png`)

export function PlanetPicker({ value, onChange }: PlanetPickerProps) {
  const [expanded, setExpanded] = useState(false)

  const visiblePlanets = expanded ? PLANETS : PLANETS.slice(0, ROW_SIZE)
  const hasMore = PLANETS.length > ROW_SIZE

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm text-[var(--text-muted)]">Planet Icon (Space View)</label>
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-white transition-colors"
          >
            {expanded ? 'Collapse' : `${PLANETS.length - ROW_SIZE} more`}
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
      <div className={cn(
        'flex gap-2 flex-wrap',
        expanded && 'max-h-[200px] overflow-y-auto pr-1'
      )}>
        {visiblePlanets.map((filename) => (
          <button
            key={filename}
            type="button"
            onClick={() => onChange(filename)}
            className={cn(
              'w-12 h-12 rounded-xl overflow-hidden border-2 transition-all hover:scale-105 shrink-0',
              value === filename
                ? 'border-[var(--primary)] shadow-[0_0_12px_var(--glow-color)]'
                : 'border-white/10 hover:border-white/30'
            )}
          >
            <img
              src={`/planets/${filename}`}
              alt={filename}
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
      {!value && (
        <p className="text-[10px] text-[var(--text-dim)] mt-1">Random planet assigned if none selected</p>
      )}
    </div>
  )
}
