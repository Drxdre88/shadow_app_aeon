'use client'

import { motion } from 'framer-motion'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]

// Full-screen focus modal — scrim + a near-full-bleed framed surface. The
// chat is a takeover (history rail + conversation), not a side drawer, so the
// operator can focus. Pure shell: animation + a11y only, no business logic.
export function KairosVisorShell({
  onClose,
  children,
}: {
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Kairos AI"
        className="fixed inset-3 z-50 flex overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950 shadow-2xl md:inset-6"
        style={{ boxShadow: '0 0 60px rgba(139,92,246,0.12), 0 24px 80px rgba(0,0,0,0.6)' }}
        initial={{ opacity: 0, scale: 0.975, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.975, y: 12 }}
        transition={{ duration: 0.32, ease: EASE }}
      >
        {children}
      </motion.div>
    </>
  )
}
