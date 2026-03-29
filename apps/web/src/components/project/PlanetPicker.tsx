'use client'

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface PlanetPickerProps {
  value: string
  onChange: (filename: string) => void
}

const ROW_SIZE = 6

export function PlanetPicker({ value, onChange }: PlanetPickerProps) {
  const [planets, setPlanets] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch('/api/planets')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load planets')
        return r.json()
      })
      .then((files: unknown) => {
        if (Array.isArray(files) && files.every((f) => typeof f === 'string')) {
          setPlanets(files)
        } else {
          setPlanets(['planet1.png'])
        }
      })
      .catch(() => setPlanets(['planet1.png']))
  }, [])

  if (planets.length === 0) return null

  const visiblePlanets = expanded ? planets : planets.slice(0, ROW_SIZE)
  const hasMore = planets.length > ROW_SIZE

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
            {expanded ? 'Collapse' : `${planets.length - ROW_SIZE} more`}
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
