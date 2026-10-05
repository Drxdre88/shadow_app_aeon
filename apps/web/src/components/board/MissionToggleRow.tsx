'use client'

import { cn } from '@/lib/utils/cn'

/** A labelled on/off switch row for mission settings. */
export function MissionToggleRow({
  title,
  hint,
  checked,
  onToggle,
}: {
  title: string
  hint: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] transition-all"
      aria-pressed={checked}
    >
      <span className="text-left">
        <span className="block text-sm text-white">{title}</span>
        <span className="block text-[10px] text-slate-500">{hint}</span>
      </span>
      <span className={cn('w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ml-3', checked ? 'bg-[var(--primary)]/70' : 'bg-white/15')}>
        <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}
