'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Moon, X, Check } from 'lucide-react'
import { createMemory, listMemoriesForUser } from '@/lib/actions/memories'
import { toast } from '@/components/ui/Toast'

// Sidebar entry for the End-of-Day reflection. Replaces the auto-popping
// card that used to slam into the top of /dashboard after 6pm — opens as a
// small popover on click, persists nothing visual unless asked.

function todayTag(): string {
  return new Date().toISOString().slice(0, 10)
}

export function EodReflectionButton() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [alreadyToday, setAlreadyToday] = useState<boolean | null>(null)
  const [happened, setHappened] = useState('')
  const [decided, setDecided] = useState('')
  const [stillOpen, setStillOpen] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const measureAnchor = useCallback(() => {
    const el = buttonRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAnchor({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [])

  useEffect(() => {
    if (!open) return
    measureAnchor()
    window.addEventListener('resize', measureAnchor)
    window.addEventListener('scroll', measureAnchor, true)
    return () => {
      window.removeEventListener('resize', measureAnchor)
      window.removeEventListener('scroll', measureAnchor, true)
    }
  }, [open, measureAnchor])

  useEffect(() => {
    if (!open) return
    if (alreadyToday !== null) return
    listMemoriesForUser({ type: 'reflection', limit: 20 })
      .then((rows) => {
        const tag = todayTag()
        setAlreadyToday(rows.some((m) => Array.isArray(m.tags) && (m.tags as string[]).includes(tag)))
      })
      .catch(() => setAlreadyToday(false))
  }, [open, alreadyToday])

  const submit = async () => {
    if (submitting) return
    if (!happened.trim() && !decided.trim() && !stillOpen.trim()) {
      toast('Write at least one section before saving.', { force: true })
      return
    }
    setSubmitting(true)
    const tag = todayTag()
    const body = [
      happened.trim() && `## What happened\n\n${happened.trim()}`,
      decided.trim()  && `## What did I decide\n\n${decided.trim()}`,
      stillOpen.trim() && `## What's still open\n\n${stillOpen.trim()}`,
    ].filter(Boolean).join('\n\n')
    try {
      await createMemory({
        title: `EOD reflection · ${tag}`,
        bodyMd: body,
        type: 'reflection',
        source: 'manual',
        tags: ['eod', tag],
      })
      toast('EOD saved ✓', { force: true })
      setAlreadyToday(true)
      setHappened('')
      setDecided('')
      setStillOpen('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save reflection', { force: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        title="End-of-day reflection"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Moon className="w-4 h-4" />
      </motion.button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && anchor && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[170]"
                onClick={() => setOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed',
                  bottom: typeof window !== 'undefined' ? window.innerHeight - anchor.top + 8 : 0,
                  left: Math.max(8, anchor.left),
                  width: 'min(440px, calc(100vw - 16px))',
                  maxHeight: '70vh',
                  zIndex: 171,
                }}
                className="rounded-2xl bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
              >
                <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
                  <div className="flex items-center gap-2">
                    <Moon className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">End of Day</span>
                    <span className="text-[10px] text-white/30">{todayTag()}</span>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                  {alreadyToday ? (
                    <div className="flex items-center gap-2 text-[12px] text-white/65 py-2">
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      Reflected today. Add more if anything else surfaced.
                    </div>
                  ) : null}

                  <Field label="What happened today?" value={happened} onChange={setHappened} />
                  <Field label="What did I decide?"  value={decided}  onChange={setDecided} />
                  <Field label="What's still open?"  value={stillOpen} onChange={setStillOpen} />

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={submit}
                      disabled={submitting}
                      className="px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.18em] transition-all disabled:opacity-40"
                      style={{
                        background: 'color-mix(in oklab, var(--primary) 18%, transparent)',
                        border: '1px solid color-mix(in oklab, var(--primary) 45%, transparent)',
                        color: 'color-mix(in oklab, var(--primary) 22%, white)',
                        boxShadow: '0 0 14px color-mix(in oklab, var(--primary) 25%, transparent)',
                      }}
                    >
                      {submitting ? 'Saving…' : 'Save reflection'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="resize-none rounded-lg bg-black/30 border border-white/[0.08] focus:border-white/[0.22] outline-none px-2.5 py-1.5 text-[12.5px] text-white/85 placeholder:text-white/25"
        placeholder="…"
      />
    </label>
  )
}
