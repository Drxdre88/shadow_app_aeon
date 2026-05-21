'use client'

import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'

// The Quick Capture overlay listens for ⌘/Ctrl+Shift+Space. To open it from
// a click we dispatch the same synthetic event so we don't have to lift state.
function openQuickCapture() {
  const e = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    ctrlKey: true,
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(e)
}

export function CaptureFab() {
  const pathname = usePathname()
  // The Cortex already has its own capture rail — no need for a FAB there.
  const hidden = pathname?.startsWith('/brain')

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.button
          key="capture-fab"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={openQuickCapture}
          aria-label="Quick capture (⌘⇧Space)"
          title="Quick capture · ⌘⇧Space"
          className="fixed z-[300] bottom-6 right-6 w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(139,92,246,0.95), rgba(99,102,241,0.95))',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.10), 0 14px 40px rgba(0,0,0,0.55), 0 0 28px rgba(139,92,246,0.35)',
            color: 'white',
          }}
        >
          <Plus className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
