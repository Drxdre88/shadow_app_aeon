'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { STATUS_OPTIONS, type ChecklistStatus } from './types'

export function StatusBadge({
  status,
  onStatusChange,
}: {
  status: ChecklistStatus
  onStatusChange: (s: ChecklistStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const current = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[3]

  if (!status && !open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="px-1.5 py-0.5 rounded text-[10px] text-slate-600 hover:text-slate-400 hover:bg-white/5 transition-all opacity-0 group-hover:opacity-100"
      >
        status
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={cn(
          'px-2 py-0.5 rounded-md text-[10px] font-medium border transition-all',
          current.color
        )}
        style={{ boxShadow: current.glow }}
      >
        {current.label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-black/90 backdrop-blur-xl border border-white/10 rounded-lg p-1 min-w-[120px] shadow-xl">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={(e) => {
                  e.stopPropagation()
                  onStatusChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'w-full px-3 py-1.5 rounded-md text-xs text-left transition-all',
                  'hover:bg-white/10',
                  status === opt.value ? 'text-white' : 'text-slate-400'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
