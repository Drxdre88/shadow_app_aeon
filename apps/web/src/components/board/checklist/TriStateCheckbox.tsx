'use client'

import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { CheckState } from './types'

export function nextState(current: CheckState): CheckState {
  if (current === 'unchecked') return 'checked'
  if (current === 'checked') return 'crossed'
  return 'unchecked'
}

export function TriStateCheckbox({ state, onClick }: { state: CheckState; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-300',
        'flex items-center justify-center',
        state === 'checked' && 'bg-emerald-500 border-emerald-400',
        state === 'crossed' && 'bg-red-500 border-red-400',
        state === 'unchecked' && 'border-white/30 hover:border-white/50'
      )}
      style={{
        boxShadow:
          state === 'checked'
            ? '0 0 12px rgba(16,185,129,0.6), 0 0 24px rgba(16,185,129,0.3)'
            : state === 'crossed'
              ? '0 0 12px rgba(239,68,68,0.6), 0 0 24px rgba(239,68,68,0.3)'
              : undefined,
      }}
    >
      {state === 'checked' && <Check className="w-3 h-3 text-white drop-shadow-[0_0_4px_rgba(16,185,129,0.8)]" />}
      {state === 'crossed' && <X className="w-3 h-3 text-white drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]" />}
    </button>
  )
}
