'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Archive, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'

interface VaultDaysModalProps {
  isOpen: boolean
  taskName: string
  onConfirm: (daysTaken: number | null) => void
  onClose: () => void
}

export function VaultDaysModal({ isOpen, taskName, onConfirm, onClose }: VaultDaysModalProps) {
  const [days, setDays] = useState('1')
  const inputRef = useRef<HTMLInputElement>(null)
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => {
    if (isOpen) {
      setDays('1')
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    }
  }, [isOpen])

  const handleSubmit = () => {
    const parsed = days.trim() ? Math.round(parseFloat(days)) : null
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) return
    onConfirm(parsed)
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') handleSubmit()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, days, onClose])

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
            boxShadow: `0 0 ${30 * mult}px rgba(16,185,129,${0.15 * mult}), 0 0 ${60 * mult}px rgba(16,185,129,${0.08 * mult})`,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Archive className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Send to Vault</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-400 mb-3 line-clamp-1">
            Archiving <span className="text-slate-200 font-medium">{taskName}</span>
          </p>

          <div className="mb-4">
            <label className="block text-xs text-slate-400 mb-1.5">How many days did this take?</label>
            <input
              ref={inputRef}
              type="number"
              min="0"
              max="9999"
              step="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Optional"
              className={cn(
                'w-full px-3 py-2 rounded-lg text-sm text-slate-200 placeholder-slate-500',
                'bg-slate-800/50 border border-white/10 outline-none',
                'focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20',
                'transition-all'
              )}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 bg-slate-800/50 border border-white/10 hover:bg-slate-700/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
              style={{
                boxShadow: `0 0 ${12 * mult}px rgba(16,185,129,${0.2 * mult})`,
              }}
            >
              Send to Vault
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
