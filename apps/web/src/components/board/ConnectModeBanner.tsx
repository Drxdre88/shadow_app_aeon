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
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 px-6 py-3 rounded-2xl backdrop-blur-xl bg-purple-500/20 border border-purple-500/40 text-white flex items-center gap-3 shadow-[0_0_30px_rgba(168,85,247,0.3)]"
          >
            <div className="relative">
              <Link2 className="w-5 h-5 text-purple-400" />
              <span className="absolute inset-0 rounded-full animate-ping bg-purple-400/30" />
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
          className="fixed pointer-events-none z-[150] px-3 py-1.5 rounded-lg backdrop-blur-xl bg-purple-500/30 border border-purple-500/50 text-white text-xs font-medium shadow-lg"
          style={{
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
