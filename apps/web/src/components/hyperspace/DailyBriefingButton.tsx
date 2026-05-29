'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, X } from 'lucide-react'
import { DailyBriefingCard } from './DailyBriefingCard'

// Sidebar entry for the Daily Briefing card. Replaces the auto-pinned card
// that used to dominate the top of the dashboard — same component, just
// gated behind a click instead of forcing itself into view on every load.

export function DailyBriefingButton() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
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

  return (
    <>
      <motion.button
        ref={buttonRef}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        title="Daily briefing"
        className="relative block p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-current"
      >
        <Sun className="w-4 h-4" />
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
                  width: 'min(520px, calc(100vw - 16px))',
                  maxHeight: '70vh',
                  zIndex: 171,
                }}
                className="rounded-2xl bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden"
              >
                <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
                  <div className="flex items-center gap-2">
                    <Sun className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
                    <span className="text-[11px] uppercase tracking-[0.22em] text-white/65">Daily Briefing</span>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="p-1 rounded-md text-white/35 hover:text-white/85 hover:bg-white/[0.06]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </header>

                <div className="flex-1 overflow-y-auto p-3">
                  <DailyBriefingCard />
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
