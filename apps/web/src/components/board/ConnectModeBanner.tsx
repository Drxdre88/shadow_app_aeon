'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Link2 } from 'lucide-react'

interface ConnectModeBannerProps {
  connectMode: boolean
  connectSourceId: string | null
  cursorPos: { x: number; y: number }
  onCancel: () => void
}

export function ConnectModeBanner({ connectMode, connectSourceId, cursorPos, onCancel }: ConnectModeBannerProps) {
  return (
    <>
      <AnimatePresence>
        {connectMode && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 px-6 py-3 rounded-2xl backdrop-blur-xl text-white flex items-center gap-3"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
              border: '1px solid color-mix(in srgb, var(--primary) 40%, transparent)',
              boxShadow: '0 0 30px var(--glow-color)',
            }}
          >
            <div className="relative">
              <Link2 className="w-5 h-5" style={{ color: 'var(--primary)' }} />
              <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)' }} />
            </div>
            <span className="text-sm font-medium">
              {connectSourceId
                ? 'Now click the task that is BLOCKED (target)'
                : 'Click the task that BLOCKS others (source)'}
            </span>
            <button
              onClick={onCancel}
              className="px-3 py-1 rounded-lg bg-white/10 text-sm hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {connectMode && (
        <div
          className="fixed pointer-events-none z-[150] px-3 py-1.5 rounded-lg backdrop-blur-xl text-white text-xs font-medium shadow-lg"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary) 50%, transparent)',
            left: cursorPos.x + 16,
            top: cursorPos.y + 16,
            transform: 'translateY(-50%)',
          }}
        >
          {connectSourceId ? 'Click target task' : 'Click source task (blocker)'}
        </div>
      )}
    </>
  )
}
