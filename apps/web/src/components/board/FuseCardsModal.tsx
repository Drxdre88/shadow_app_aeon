'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { Merge, X, Loader2, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore, useSmoothUiRenders } from '@/stores/themeStore'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { resolveAccentHex } from '@/lib/utils/colors'
import { maxPriority, unionIds } from '@/lib/utils/fuseRules'

export const MAX_FUSED_NAME = 255

interface FuseCardsModalProps {
  isOpen: boolean
  /** The selected cards — absorbed and removed, in selection order. */
  sources: BoardTask[]
  /** The card whose menu asked — survives, renamed. */
  target: BoardTask | null
  isLoading?: boolean
  onConfirm: (name: string) => void
  onClose: () => void
}

export function isValidFusedName(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_FUSED_NAME
}

// AnimatePresence sits ABOVE the open check so the dialog's exit plays: a
// child that simply stops being rendered is what it animates out.
export function FuseCardsModal({ isOpen, sources, target, ...props }: FuseCardsModalProps) {
  const mounted = useHasMounted()
  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {isOpen && sources.length > 0 && target && (
        <FuseCardsDialog key={`${sources.map((s) => s.id).join('+')}->${target.id}`} sources={sources} target={target} {...props} />
      )}
    </AnimatePresence>,
    document.body
  )
}

function FuseCardsDialog({ sources, target, isLoading = false, onConfirm, onClose }: Omit<FuseCardsModalProps, 'isOpen' | 'sources' | 'target'> & { sources: BoardTask[]; target: BoardTask }) {
  const [name, setName] = useState(target.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const smoothUiRenders = useSmoothUiRenders()
  const reduceMotion = !smoothUiRenders
  const mult = glowIntensity / 75
  const checklistSummaries = useBoardStore((s) => s.checklistSummaries)
  const armed = isValidFusedName(name) && !isLoading
  const accent = resolveAccentHex(target.color)

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, reduceMotion ? 0 : 100)
    return () => clearTimeout(timer)
  }, [reduceMotion])

  // Capture phase + stopPropagation: while this dialog is up, Escape is its
  // alone (the board's shortcuts and hold-to-move listen on window too), and
  // Enter confirms only when the keyboard focus is actually inside it.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!isLoading) onClose()
        return
      }
      if (e.key === 'Enter' && armed && dialogRef.current?.contains(document.activeElement)) {
        e.stopPropagation()
        onConfirm(name.trim())
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [isLoading, armed, name, onConfirm, onClose])

  const cancel = () => { if (!isLoading) onClose() }

  const labelCount = sources.reduce((ids, s) => unionIds(ids, s.labels), target.labels as string[]).length
  const checklistCount = sources.reduce((n, s) => n + (checklistSummaries[s.id]?.total ?? 0), 0)
  const priority = sources.reduce((p, s) => maxPriority(p, s.priority), target.priority as string)
  const sourceHasDescription = sources.some((s) => !!s.description?.trim())
  const absorbedNoun = sources.length === 1 ? 'The absorbed card is' : `The ${sources.length} absorbed cards are`

  return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className="fixed inset-0 z-[200] flex items-center justify-center"
        onClick={cancel}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="fuse-cards-title"
          initial={reduceMotion ? false : { scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl p-5"
          style={{
            boxShadow: `0 0 ${30 * mult}px ${accent}33, 0 0 ${60 * mult}px ${accent}1a`,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg border" style={{ backgroundColor: `${accent}33`, borderColor: `${accent}66` }}>
                <Merge className="w-4 h-4" style={{ color: accent }} />
              </div>
              <span id="fuse-cards-title" className="text-sm font-medium text-slate-200">Fuse Cards</span>
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

          <div className="flex items-center gap-2 mb-4 text-xs">
            <AbsorbedChip sources={sources} />
            <ArrowRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <CardChip task={target} label="Survives" />
          </div>

          <div className="mb-3">
            <label htmlFor="fuse-cards-name" className="block text-xs text-slate-400 mb-1.5">New title</label>
            <input
              id="fuse-cards-name"
              ref={inputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={MAX_FUSED_NAME}
              value={name}
              disabled={isLoading}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm text-slate-200 placeholder-slate-600',
                'bg-slate-800/50 border border-white/10 outline-none',
                'focus:border-white/25 focus:ring-1 focus:ring-white/10',
                'transition-all disabled:opacity-50'
              )}
            />
          </div>

          <ul className="text-xs text-slate-400 space-y-1 mb-4" data-testid="fuse-summary">
            <li>Labels, assignees, dependencies and comments are combined ({labelCount} label{labelCount === 1 ? '' : 's'}).</li>
            <li>{checklistCount > 0 ? `${checklistCount} checklist item${checklistCount === 1 ? '' : 's'} move over.` : 'No checklist items to move.'}</li>
            <li>Priority becomes <span className="text-slate-200 capitalize">{priority}</span>; dates widen to cover both.</li>
            {sourceHasDescription && <li>Absorbed descriptions are appended below the survivor&apos;s.</li>}
            <li>{absorbedNoun} removed. Undo from the toast right after.</li>
          </ul>

          <div className="flex gap-2">
            <button
              onClick={cancel}
              disabled={isLoading}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/50 border border-white/10 hover:bg-slate-700/50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={() => armed && onConfirm(name.trim())}
              disabled={!armed}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 border transition-colors',
                armed ? 'text-white' : 'opacity-40 cursor-not-allowed text-slate-300'
              )}
              style={{
                backgroundColor: `${accent}26`,
                borderColor: `${accent}66`,
                boxShadow: armed ? `0 0 ${12 * mult}px ${accent}40` : undefined,
              }}
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />}
              {isLoading ? 'Fusing…' : `Fuse ${sources.length + 1} cards`}
            </button>
          </div>
        </motion.div>
      </motion.div>
  )
}

// One absorbed card gets the same chip as the survivor; several are listed,
// three by name and the rest counted, all of them in the tooltip.
function AbsorbedChip({ sources }: { sources: BoardTask[] }) {
  if (sources.length === 1) return <CardChip task={sources[0]} label="Absorbed" />
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-white/10 bg-slate-800/40 px-2.5 py-2" title={sources.map((s) => s.name).join('\n')}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">{sources.length} absorbed</div>
      <ul className="space-y-0.5">
        {sources.slice(0, 3).map((s) => (
          <li key={s.id} className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resolveAccentHex(s.color) }} />
            <span className="truncate text-slate-200">{s.name}</span>
          </li>
        ))}
        {sources.length > 3 && <li className="text-slate-500">+{sources.length - 3} more</li>}
      </ul>
    </div>
  )
}

function CardChip({ task, label }: { task: BoardTask; label: string }) {
  const accent = resolveAccentHex(task.color)
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-white/10 bg-slate-800/40 px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <span className="truncate text-slate-200" title={task.name}>{task.name}</span>
      </div>
    </div>
  )
}
