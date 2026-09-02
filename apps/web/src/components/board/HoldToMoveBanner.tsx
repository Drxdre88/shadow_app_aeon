'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Move, X } from 'lucide-react'
import { useMovingTaskId, useBoardStore } from '@/lib/store/boardStore'
import { useSmoothUiRenders } from '@/stores/themeStore'

// The hint shown while a card is lifted by hold-to-move. Fixed to the
// viewport so it reads the same on the board and over the Zen panel. The X
// cancels the move: there is nothing else to "dismiss" to.
export function HoldToMoveBanner({ onCancel }: { onCancel: () => void }) {
  const movingTaskId = useMovingTaskId()
  const name = useBoardStore((s) => (movingTaskId ? s.tasks.find((t) => t.id === movingTaskId)?.name : undefined))
  const smooth = useSmoothUiRenders()

  return (
    <AnimatePresence>
      {movingTaskId && (
        <motion.div
          data-hold-to-move-banner
          role="status"
          initial={smooth ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          exit={smooth ? { opacity: 0, y: 12 } : undefined}
          transition={{ duration: smooth ? 0.18 : 0 }}
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border border-white/15 bg-[#12121a]/90 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.45)] text-xs text-slate-200 max-w-[calc(100vw-2rem)]"
        >
          <Move className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--primary)' }} />
          <span className="truncate">
            {name ? <span className="font-medium text-white">{name}</span> : 'Moving card'}
            <span className="text-slate-400"> · Tap where to place</span>
            <span className="hidden sm:inline text-slate-500"> · Esc to cancel</span>
          </span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel move"
            title="Cancel move"
            className="p-1 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
