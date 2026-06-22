'use client'

import { Check, Loader2, RefreshCw, AlertTriangle, CloudOff } from 'lucide-react'
import { useBoardStore } from '@/lib/store/boardStore'
import { useMutationQueue } from '@/lib/store/mutationQueue'
import { cn } from '@/lib/utils/cn'

const PRESENTS = {
  saving: { Icon: Loader2, text: 'Saving…', cls: 'text-sky-300', spin: true },
  retrying: { Icon: RefreshCw, text: 'Reconnecting…', cls: 'text-amber-300', spin: true },
  saved: { Icon: Check, text: 'Saved', cls: 'text-emerald-300', spin: false },
  error: { Icon: AlertTriangle, text: 'Couldn’t save', cls: 'text-rose-300', spin: false },
  offline: { Icon: CloudOff, text: 'Offline — saved here', cls: 'text-amber-300', spin: false },
} as const

// Live "is my work safe?" signal in the board header. Driven by the durable
// save path: Saving → Reconnecting (during a DB resume) → Saved, or a sticky
// Offline showing how many edits are queued to sync. Resting state is a quiet
// green dot so the header isn't noisy when nothing is in flight.
export function SaveStatusPill() {
  const saveStatus = useBoardStore((s) => s.saveStatus)
  const isDirty = useBoardStore((s) => s.isDirty)
  const pending = useMutationQueue((s) => s.pending.length)

  // Bridge the instant after an optimistic store edit but before the network
  // call sets 'saving': a dirty-but-idle board is really "saving".
  const status = saveStatus === 'idle' && isDirty ? 'saving' : saveStatus

  if (status === 'idle') {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/60" title="All changes saved">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
        <span className="hidden sm:inline">Saved</span>
      </div>
    )
  }

  const { Icon, text, cls, spin } = PRESENTS[status]
  const suffix = (status === 'offline' || status === 'retrying') && pending > 0 ? ` (${pending})` : ''
  return (
    <div className={cn('flex items-center gap-1.5 text-[11px] transition-colors', cls)} title={`${text}${suffix}`}>
      <Icon className={cn('w-3 h-3', spin && 'animate-spin')} />
      <span className="hidden sm:inline">
        {text}
        {suffix}
      </span>
    </div>
  )
}
