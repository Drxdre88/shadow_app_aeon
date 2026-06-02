'use client'

import { motion } from 'framer-motion'

// Slide-out aside + scrim. Pure shell — no business logic, no state.
// Kept separate so the animation transition + a11y attributes live in
// one place and the parent can focus on flow.
export function KairosVisorShell({
  width,
  onClose,
  children,
}: {
  width: number
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Kairos chat"
        className="fixed right-0 top-0 z-50 flex h-screen flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl"
        style={{ width }}
        initial={{ x: width }}
        animate={{ x: 0 }}
        exit={{ x: width }}
        transition={{ type: 'spring', stiffness: 320, damping: 36 }}
      >
        {children}
      </motion.aside>
    </>
  )
}
