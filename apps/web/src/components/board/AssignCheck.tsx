'use client'

import { Check } from 'lucide-react'

/** The assigned/unassigned tick shared by the real- and virtual-member rows. */
export function AssignCheck({ assigned }: { assigned: boolean }) {
  return (
    <span
      className={`shrink-0 w-5 h-5 rounded-md inline-flex items-center justify-center transition-colors ${
        assigned
          ? 'bg-emerald-500/20 border border-emerald-500/35 text-emerald-200'
          : 'bg-white/[0.03] border border-white/[0.08] text-white/30 group-hover:text-white/60'
      }`}
    >
      <Check className="w-3 h-3" style={{ opacity: assigned ? 1 : 0 }} />
    </span>
  )
}
