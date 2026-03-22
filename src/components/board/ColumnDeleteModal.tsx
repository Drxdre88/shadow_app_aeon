'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'

interface ColumnDeleteModalProps {
  isOpen: boolean
  columnName: string
  taskCount: number
  onConfirm: () => void
  onClose: () => void
}

export function ColumnDeleteModal({ isOpen, columnName, taskCount, onConfirm, onClose }: ColumnDeleteModalProps) {
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      const target = e.target as HTMLElement
      if (e.key === 'Enter' && !target.closest('input, textarea')) onConfirm()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onConfirm, onClose])

  if (!isOpen) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 w-[360px] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl p-5"
          style={{
            boxShadow: `0 0 ${30 * mult}px rgba(239,68,68,${0.15 * mult}), 0 0 ${60 * mult}px rgba(239,68,68,${0.08 * mult})`,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-red-500/20 border border-red-500/30">
                <Trash2 className="w-4 h-4 text-red-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Delete Column</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-slate-300 mb-1">
            Delete <span className="font-medium text-white">{columnName}</span>?
          </p>
          {taskCount > 0 && (
            <p className="text-xs text-red-400 mb-4">
              This will also delete {taskCount} card{taskCount !== 1 ? 's' : ''} in this column.
            </p>
          )}
          {taskCount === 0 && <p className="text-xs text-slate-500 mb-4">This column is empty.</p>}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/50 border border-white/10 hover:bg-slate-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                'flex-1 px-3 py-2 rounded-lg text-xs font-medium',
                'text-red-300 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 transition-colors'
              )}
              style={{
                boxShadow: `0 0 ${12 * mult}px rgba(239,68,68,${0.2 * mult})`,
              }}
            >
              Delete
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
