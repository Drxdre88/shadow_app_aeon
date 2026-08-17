'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Ruler, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { updateProjectSettings } from '@/lib/actions/projects'
import { toast } from '@/components/ui/Toast'
import { NeonButton } from '@/components/ui/NeonButton'
import {
  parseSizing,
  clampSizingValue,
  useBoardSizingStore,
  MAX_SIZING_LABELS,
  MIN_SIZING_VALUE,
  MAX_SIZING_VALUE,
  type BoardSizing,
} from './sizing'

interface BoardSizingButtonProps {
  projectId: string
  settings: Record<string, unknown> | null | undefined
}

export function BoardSizingButton({ projectId, settings }: BoardSizingButtonProps) {
  const sizing = useBoardSizingStore((s) => s.sizing)
  const setSizing = useBoardSizingStore((s) => s.setSizing)
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState<BoardSizing>(() => parseSizing(settings))
  const [saving, setSaving] = useState(false)

  // Hydrate once per distinct server value: the settings prop is a fresh object
  // on every parent render, and a blind re-hydrate would stomp a just-saved
  // config before the revalidated payload arrives.
  const hydratedRef = useRef<string | null>(null)
  useEffect(() => {
    const key = JSON.stringify((settings as { sizing?: unknown } | null | undefined)?.sizing ?? null)
    if (hydratedRef.current === key) return
    hydratedRef.current = key
    setSizing(parseSizing(settings))
  }, [settings, setSizing])

  const openModal = () => {
    setDraft(sizing)
    setIsOpen(true)
  }

  const updateLabel = (index: number, patch: { key?: string; value?: number }) => {
    setDraft((d) => ({
      ...d,
      labels: d.labels.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }))
  }

  const handleSave = async () => {
    const labels = draft.labels
      .map((l) => ({ key: l.key.trim().slice(0, 6), value: clampSizingValue(l.value) }))
      .filter((l) => l.key.length > 0)
    if (labels.length === 0) {
      toast('Add at least one size')
      return
    }
    const next: BoardSizing = { ...draft, labels }
    setSizing(next)
    setSaving(true)
    try {
      await updateProjectSettings(projectId, { ...(settings ?? {}), sizing: next })
      setIsOpen(false)
    } catch {
      setSizing(parseSizing(settings))
      toast('Could not save sizing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        title="Task sizing"
        className={cn(
          'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          sizing.enabled ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
        )}
      >
        <Ruler className="w-4 h-4" />
        <span>Sizing</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={() => setIsOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full max-w-md rounded-xl p-5 space-y-4',
                'bg-gradient-to-b from-white/10 to-black/40 backdrop-blur-md',
                'border border-white/10 shadow-[0_0_40px_rgba(99,102,241,0.3)]'
              )}
            >
              <div>
                <h3 className="text-white font-medium">Task sizing</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Board-wide size ladder. Each label maps to a number written to the card&apos;s size.
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
                <span>Enable sizing</span>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  className="w-4 h-4 accent-[var(--primary)]"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-300">Unit</span>
                <div className="flex gap-2">
                  {(['days', 'points'] as const).map((unit) => (
                    <button
                      key={unit}
                      onClick={() => setDraft({ ...draft, unit })}
                      className={cn(
                        'px-3 py-1 rounded-lg text-xs capitalize border transition-all',
                        draft.unit === unit
                          ? 'bg-white/10 border-white/30 text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                      )}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {draft.labels.map((label, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={label.key}
                      onChange={(e) => updateLabel(index, { key: e.target.value })}
                      maxLength={6}
                      placeholder="S"
                      className="w-20 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/25"
                    />
                    <input
                      type="number"
                      value={label.value}
                      step={0.5}
                      min={MIN_SIZING_VALUE}
                      max={MAX_SIZING_VALUE}
                      onChange={(e) => updateLabel(index, { value: Number(e.target.value) })}
                      className="w-24 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/25"
                    />
                    <span className="text-xs text-slate-500 flex-1">{draft.unit}</span>
                    <button
                      onClick={() => setDraft({ ...draft, labels: draft.labels.filter((_, i) => i !== index) })}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove size"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {draft.labels.length < MAX_SIZING_LABELS && (
                  <button
                    onClick={() => setDraft({ ...draft, labels: [...draft.labels, { key: '', value: 1 }] })}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-400 bg-white/5 border border-dashed border-white/20 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                    Add size
                  </button>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all"
                >
                  Cancel
                </button>
                <NeonButton onClick={handleSave} disabled={saving} color="purple">
                  {saving ? 'Saving...' : 'Save'}
                </NeonButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
