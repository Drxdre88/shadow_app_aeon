'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { toast } from '@/components/ui/Toast'
import { getMissionCheckSetting, setMissionCheck } from '@/lib/actions/mission-check'

interface MissionCheckToggleProps {
  projectId: string
  isOpen: boolean
}

/**
 * Board settings switch for "Vorath checks finished missions". Saves at once
 * (its own owner-only action), and is shown only to the person who created the board.
 */
export function MissionCheckToggle({ projectId, isOpen }: MissionCheckToggleProps) {
  const [state, setState] = useState<{ on: boolean; canToggle: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getMissionCheckSetting(projectId)
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
      await setMissionCheck(projectId, next)
    } catch (err) {
      setState({ ...state, on: !next })
      toast(err instanceof Error ? err.message : 'Could not change mission checks')
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
          <ShieldCheck className="w-4 h-4 text-[var(--primary)] flex-shrink-0" />
          <span>
            <span className="block text-sm text-white">Vorath checks finished missions</span>
            <span className="block text-[10px] text-slate-500">
              Leaves a second opinion on finished missions, based on what the mission reported. It never moves or closes a card.
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
