'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useIsPresent } from 'framer-motion'
import { createPortal } from 'react-dom'
import { RefreshCw, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore, useSmoothUiRenders } from '@/stores/themeStore'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'

export const RESET_CONFIRM_WORD = 'RESET'

/**
 * Mirrors the server-side scope in resetGanttProjectData: either half of the
 * timeline link qualifies a card, and only the dated ones actually lose dates.
 */
export function countTimelineResetImpact(tasks: BoardTask[]) {
  const affected = tasks.filter((t) => t.onTimeline || !!t.ganttTaskId)
  const dated = affected.filter((t) => !!t.startDate || !!t.endDate)
  return { affected: affected.length, dated: dated.length }
}

export function isResetConfirmation(value: string) {
  return value.trim().toUpperCase() === RESET_CONFIRM_WORD
}

interface GanttResetModalProps {
  isOpen: boolean
  isLoading?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * AnimatePresence sits above the open/closed branch so the dialog stays mounted
 * through its exit animation instead of vanishing with the thing it animates.
 * The constant key keeps one dialog instance across re-renders (isLoading
 * flips must not remount it), so the exit runs once and the opener-focus
 * cleanup fires only when that exit has finished.
 */
export function GanttResetModal({ isOpen, ...props }: GanttResetModalProps) {
  return <AnimatePresence>{isOpen ? <GanttResetDialog key="gantt-reset" {...props} /> : null}</AnimatePresence>
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

function GanttResetDialog({ isLoading = false, onConfirm, onClose }: Omit<GanttResetModalProps, 'isOpen'>) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [wasLoading, setWasLoading] = useState(isLoading)
  if (wasLoading !== isLoading) {
    setWasLoading(isLoading)
    if (wasLoading && !isLoading) setTyped('')
  }
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const smoothUiRenders = useSmoothUiRenders()
  const reduceMotion = !smoothUiRenders
  const mult = glowIntensity / 75
  const tasks = useBoardStore((s) => s.tasks)
  const { affected, dated } = countTimelineResetImpact(tasks)
  // False while animating out: a dialog that is already closing must not
  // still confirm on Enter, trap Tab, or swallow the clicks meant for the
  // board underneath its fading overlay.
  const isPresent = useIsPresent()
  const armed = isResetConfirmation(typed) && !isLoading && isPresent

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => opener?.focus()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), reduceMotion ? 0 : 100)
    return () => clearTimeout(timer)
  }, [reduceMotion])

  useEffect(() => {
    const cycleFocus = (e: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof HTMLElement && dialog.contains(active)
      if (e.shiftKey ? active === first || !inside : active === last || !inside) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (!isPresent) return
      if (e.key === 'Escape' && !isLoading) onClose()
      if (e.key === 'Enter' && armed) onConfirm()
      if (e.key === 'Tab') cycleFocus(e)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isPresent, isLoading, armed, onConfirm, onClose])

  const cancel = () => { if (!isLoading) onClose() }
  const plural = (n: number) => (n === 1 ? 'card' : 'cards')

  return createPortal(
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={isPresent ? undefined : { pointerEvents: 'none' }}
      onClick={cancel}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gantt-reset-title"
        initial={reduceMotion ? false : { scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-[380px] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl p-5"
        style={{
          boxShadow: `0 0 ${30 * mult}px rgba(239,68,68,${0.15 * mult}), 0 0 ${60 * mult}px rgba(239,68,68,${0.08 * mult})`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-500/20 border border-red-500/30">
              <RefreshCw className="w-4 h-4 text-red-400" />
            </div>
            <span id="gantt-reset-title" className="text-sm font-medium text-slate-200">Reset Timeline</span>
          </div>
          <button
            onClick={cancel}
            disabled={isLoading}
            aria-label="Close"
            className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {affected > 0 ? (
          <>
            <p className="text-sm text-slate-300 mb-1">
              <span className="font-medium text-white" data-testid="reset-affected-count">{affected}</span>{' '}
              {plural(affected)} will be taken off the timeline.
            </p>
            <p className="text-xs text-red-400 mb-3">
              {dated > 0
                ? `${dated} of them ${dated === 1 ? 'has' : 'have'} start or end dates — those dates will be cleared.`
                : 'None of them carry dates yet, but their timeline placement will be removed.'}
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-500 mb-3">No cards are on the timeline. Reset only clears orphaned rows and bars.</p>
        )}
        <p className="text-xs text-slate-500 mb-4">
          Cards stay on the board. You can undo from the toast right after, or with Ctrl+Z.
        </p>

        <div className="mb-4">
          <label htmlFor="gantt-reset-confirm" className="block text-xs text-slate-400 mb-1.5">
            Type <span className="font-mono text-slate-200">{RESET_CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id="gantt-reset-confirm"
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            disabled={isLoading}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={RESET_CONFIRM_WORD}
            className={cn(
              'w-full px-3 py-2 rounded-lg text-sm text-slate-200 placeholder-slate-600 font-mono tracking-wider',
              'bg-slate-800/50 border border-white/10 outline-none',
              'focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20',
              'transition-all disabled:opacity-50'
            )}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={cancel}
            disabled={isLoading}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/50 border border-white/10 hover:bg-slate-700/50 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!armed}
            className={cn(
              'flex-1 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5',
              'text-red-300 bg-red-500/15 border border-red-500/30 transition-colors',
              armed ? 'hover:bg-red-500/25' : 'opacity-40 cursor-not-allowed'
            )}
            style={armed ? { boxShadow: `0 0 ${12 * mult}px rgba(239,68,68,${0.2 * mult})` } : undefined}
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isLoading ? 'Resetting…' : 'Reset timeline'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  )
}
