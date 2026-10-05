'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { toast } from '@/components/ui/Toast'
import { getCardTriageSetting, setCardTriage } from '@/lib/actions/card-triage'

interface CardTriageToggleProps {
  projectId: string
  isOpen: boolean
}

/**
 * Board settings switch for "Vorath sorts new cards". Saves at once (its own
 * owner-only action), and is shown only to the person who created the board.
 */
export function CardTriageToggle({ projectId, isOpen }: CardTriageToggleProps) {
  const [state, setState] = useState<{ on: boolean; canToggle: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getCardTriageSetting(projectId)
      .then((s) => { if (!cancelled) setState(s) })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [isOpen, projectId])

  if (!state?.canToggle) return null

  const toggle = async () => {
    if (saving) return
    const next = !state.on
    setSaving(true)
    setState({ ...state, on: next })
    try {
      await setCardTriage(projectId, next)
    } catch (err) {
      setState({ ...state, on: !next })
      toast(err instanceof Error ? err.message : 'Could not change card sorting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className="w-full flex items-center justify-between gap-3 disabled:opacity-70"
        aria-pressed={state.on}
      >
        <span className="flex items-center gap-2 min-w-0 text-left">
          <Sparkles className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
          <span>
            <span className="block text-sm text-white">Vorath sorts new cards</span>
            <span className="block text-[10px] text-slate-500">
              Suggests labels, a priority and possible duplicates on new cards. Nothing changes until you accept it.
            </span>
          </span>
        </span>
        <span
          className={cn(
            'w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
            state.on ? 'bg-[var(--primary)]/70' : 'bg-white/15'
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              state.on ? 'translate-x-[18px]' : 'translate-x-0.5'
            )}
          />
        </span>
      </button>
    </div>
  )
}
