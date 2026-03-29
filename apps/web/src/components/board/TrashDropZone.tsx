'use client'

import { useDroppable } from '@dnd-kit/core'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function TrashDropZone({ isActive }: { isActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash', data: { type: 'trash' } })

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          ref={setNodeRef}
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
          className={cn(
            'fixed bottom-8 left-1/2 -translate-x-1/2 z-50',
            'px-8 py-4 rounded-2xl',
            'backdrop-blur-xl border-2 border-dashed',
            'flex items-center gap-3 transition-all duration-300',
            isOver
              ? 'bg-red-500/30 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.5)]'
              : 'bg-white/5 border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.1)]'
          )}
        >
          <Trash2 className={cn('w-6 h-6 transition-colors', isOver ? 'text-red-400' : 'text-slate-400')} />
          <span className={cn('font-medium transition-colors', isOver ? 'text-red-400' : 'text-slate-400')}>
            {isOver ? 'Release to delete' : 'Drop here to delete'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
