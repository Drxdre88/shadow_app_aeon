'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { getCardTreeAvailabilityAction, requestCardTreeAction } from '@/lib/actions/card-tree'
import { NeonButton } from '@/components/ui/NeonButton'

// "Plan a goal with Vorath": the owner types a goal; Vorath drafts a small
// tree of cards later and it waits in the Vorath inbox for Approve or Veto.
// Nothing is added to the board from here. The entry stays hidden unless the
// user's brain routine is connected — otherwise nothing would ever draft it.

const GOAL_MAX = 1000

export function PlanGoalDialog({ projectId }: { projectId: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCardTreeAvailabilityAction()
      .then((res) => { if (!cancelled) setAvailable(res.available) })
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  if (!available) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Plan a goal with Vorath — he drafts the cards, you approve them"
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all text-slate-400 hover:text-white hover:bg-white/5"
      >
        <Sparkles className="w-4 h-4" />
        <span>Plan a goal</span>
      </button>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && <PlanGoalForm projectId={projectId} onClose={() => setIsOpen(false)} />}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

function PlanGoalForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [goal, setGoal] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const submit = async () => {
    setSending(true)
    try {
      const res = await requestCardTreeAction(projectId, goal)
      setResult({ ok: res.ok, message: res.message })
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Could not send the goal to Vorath' })
    } finally {
      setSending(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-goal-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-xl p-5 space-y-4',
          'bg-gradient-to-b from-white/10 to-black/40 backdrop-blur-md',
          'border border-white/10 shadow-[0_0_40px_color-mix(in_srgb,var(--primary)_30%,transparent)]'
        )}
      >
        <div>
          <h3 id="plan-goal-title" className="text-white font-medium">Plan a goal with Vorath</h3>
          <p className="text-xs text-slate-400 mt-1">
            Describe what you want to achieve. Vorath drafts up to 12 cards with their order and checklists, using this board&apos;s labels.
            Nothing is added until you approve it in the Vorath inbox.
          </p>
        </div>

        {result ? (
          <p role="status" className={cn('text-sm', result.ok ? 'text-emerald-200' : 'text-rose-300')}>{result.message}</p>
        ) : (
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            maxLength={GOAL_MAX}
            aria-label="Goal"
            placeholder="e.g. Launch the beta sign-up page by the end of the month"
            className="w-full resize-none rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-[var(--primary)]"
          />
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <NeonButton onClick={submit} disabled={sending || goal.trim().length < 3}>
              {sending ? 'Sending…' : 'Send to Vorath'}
            </NeonButton>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
