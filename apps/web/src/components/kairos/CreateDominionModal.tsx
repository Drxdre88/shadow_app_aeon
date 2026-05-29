'use client'

import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, Sparkles, Check } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { createDominionAction } from '@/lib/actions/dominions'

// Curated palette aligned with the DOMINION_COLOR_HUE lookup used by the
// Kairos graph node colouring (see lib/kairos/nodeColor.ts). Keeping the
// picker tight — 8 options is plenty, more becomes noise.
const COLOR_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'purple',  label: 'Purple',  hex: '#a855f7' },
  { id: 'sky',     label: 'Sky',     hex: '#38bdf8' },
  { id: 'teal',    label: 'Teal',    hex: '#14b8a6' },
  { id: 'emerald', label: 'Emerald', hex: '#10b981' },
  { id: 'amber',   label: 'Amber',   hex: '#f59e0b' },
  { id: 'rose',    label: 'Rose',    hex: '#f43f5e' },
  { id: 'fuchsia', label: 'Fuchsia', hex: '#d946ef' },
  { id: 'blue',    label: 'Blue',    hex: '#3b82f6' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated?: (dominionId: string) => void
}

export function CreateDominionModal({ isOpen, onClose, onCreated }: Props) {
  const mounted = useHasMounted()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const [name, setName] = useState('')
  const [vision, setVision] = useState('')
  const [mission, setMission] = useState('')
  const [color, setColor] = useState<string>('purple')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setName('')
    setVision('')
    setMission('')
    setColor('purple')
    setError(null)
    setSubmitting(false)
  }, [])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, handleKey])

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await createDominionAction({
        name: trimmed,
        color,
        vision: vision.trim() || null,
        missionLong: mission.trim() || null,
      })
      onCreated?.(created.id)
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Dominion')
      setSubmitting(false)
    }
  }

  if (!mounted || !isOpen) return null

  const activeHex = COLOR_PRESETS.find((p) => p.id === color)?.hex ?? '#a855f7'

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[200] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 24 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-2xl border border-white/[0.12] flex flex-col relative overflow-hidden',
        )}
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${10 * mult}px ${activeHex}33`,
            `0 25px 50px -12px rgba(0,0,0,0.8)`,
            `inset 0 1px 0 0 rgba(255,255,255,0.08)`,
          ].join(', '),
        }}
      >
        <div
          className="absolute top-0 left-6 right-6 h-[1.5px]"
          style={{
            background: `linear-gradient(90deg, transparent, ${activeHex}, transparent)`,
            boxShadow: `0 0 ${12 * mult}px ${2 * mult}px ${activeHex}55`,
          }}
        />

        <header className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: `${activeHex}22`,
                boxShadow: `0 0 16px ${activeHex}66`,
              }}
            >
              <Sparkles className="w-4 h-4" style={{ color: activeHex }} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">New Dominion</h2>
              <p className="text-[11px] text-white/40 mt-0.5">A theme that groups projects, repos, and memories.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 pb-5 flex flex-col gap-4">
          <Field label="Name" required>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cortex, Aeon, Health, Writing…"
              maxLength={100}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit() }}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </Field>

          <Field label="Vision">
            <textarea
              value={vision}
              onChange={(e) => setVision(e.target.value)}
              placeholder="One or two sentences. Where this is going."
              rows={2}
              maxLength={4000}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none focus:border-white/30 resize-none"
            />
          </Field>

          <Field label="Mission">
            <textarea
              value={mission}
              onChange={(e) => setMission(e.target.value)}
              placeholder="What you are actually doing. Specific."
              rows={3}
              maxLength={8000}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white/85 placeholder:text-white/25 outline-none focus:border-white/30 resize-none"
            />
          </Field>

          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {COLOR_PRESETS.map((p) => {
                const isActive = p.id === color
                return (
                  <button
                    key={p.id}
                    onClick={() => setColor(p.id)}
                    title={p.label}
                    className="w-7 h-7 rounded-lg relative flex items-center justify-center transition-all"
                    style={{
                      background: p.hex,
                      boxShadow: isActive
                        ? `0 0 0 2px rgba(255,255,255,0.85), 0 0 12px ${p.hex}cc`
                        : `0 0 0 1px rgba(255,255,255,0.1)`,
                    }}
                  >
                    {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                )
              })}
            </div>
          </Field>

          {error && <div className="text-[11px] text-rose-300">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-[12px] text-white/55 hover:text-white/90 disabled:opacity-40"
            >Cancel</button>
            <button
              onClick={submit}
              disabled={!name.trim() || submitting}
              className="px-4 py-1.5 text-[12px] font-semibold rounded-lg text-white disabled:opacity-40 transition-all inline-flex items-center gap-1.5"
              style={{
                background: `${activeHex}cc`,
                boxShadow: `0 0 18px ${activeHex}66, inset 0 1px 0 rgba(255,255,255,0.15)`,
              }}
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Creating…' : 'Create Dominion'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/45">
        {label}{required && <span className="text-rose-300 ml-1">*</span>}
      </span>
      {children}
    </label>
  )
}

export { CreateDominionModal as default }
