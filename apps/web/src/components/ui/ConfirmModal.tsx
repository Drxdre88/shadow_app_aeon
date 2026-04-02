'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  variant?: 'danger' | 'default'
}

export function ConfirmModal({ isOpen, title, message, confirmLabel = 'Confirm', onConfirm, onCancel, variant = 'default' }: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm mx-4 rounded-2xl p-6 space-y-4"
            style={{
              backgroundColor: 'rgba(15, 15, 25, 0.97)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 0 40px rgba(0,0,0,0.6)',
            }}
          >
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="text-sm text-slate-400">{message}</p>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className={
                  variant === 'danger'
                    ? 'px-4 py-2 rounded-xl text-sm font-medium bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30 transition-colors'
                    : 'px-4 py-2 rounded-xl text-sm font-medium bg-white/10 border border-white/15 text-white hover:bg-white/15 transition-colors'
                }
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
