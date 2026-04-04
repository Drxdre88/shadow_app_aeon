'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { Archive, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'

interface VaultEntry {
  taskId: string
  taskName: string
  priority: string
  daysTaken: string
}

interface BatchVaultModalProps {
  isOpen: boolean
  columnName: string
  tasks: { id: string; name: string; priority: string }[]
  onConfirm: (entries: { taskId: string; daysTaken: number | null; taskName: string }[]) => void
  onClose: () => void
}

const priorityDot: Record<string, string> = {
  low: 'bg-slate-400',
  medium: 'bg-blue-400',
  high: 'bg-orange-400',
  urgent: 'bg-red-400',
}

export function BatchVaultModal({ isOpen, columnName, tasks, onConfirm, onClose }: BatchVaultModalProps) {
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const mult = glowIntensity / 75

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries(tasks.map(t => ({
        taskId: t.id,
        taskName: t.name,
        priority: t.priority,
        daysTaken: '1',
      })))
    }
  }, [isOpen, tasks])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const updateDays = (taskId: string, value: string) => {
    setEntries(prev => prev.map(e => e.taskId === taskId ? { ...e, daysTaken: value } : e))
  }

  const handleSubmit = () => {
    const result = entries.map(e => {
      const parsed = e.daysTaken.trim() ? Math.round(parseFloat(e.daysTaken)) : null
      return {
        taskId: e.taskId,
        daysTaken: parsed !== null && !isNaN(parsed) && parsed >= 0 ? parsed : null,
        taskName: e.taskName,
      }
    })
    onConfirm(result)
  }

  if (!isOpen || tasks.length === 0) return null

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
          className="relative z-10 w-[480px] max-h-[70vh] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-xl p-5 flex flex-col"
          style={{
            boxShadow: `0 0 ${30 * mult}px rgba(16,185,129,${0.15 * mult}), 0 0 ${60 * mult}px rgba(16,185,129,${0.08 * mult})`,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Archive className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-200">Send to Vault</span>
                <span className="text-xs text-slate-500 ml-2">{columnName}</span>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-400 mb-3">
            {entries.length} completed {entries.length === 1 ? 'task' : 'tasks'} ready for vault
          </p>

          <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1 min-h-0">
            {entries.map((entry) => (
              <div
                key={entry.taskId}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/40 border border-white/5"
              >
                <div className={cn('w-2 h-2 rounded-full shrink-0', priorityDot[entry.priority] || priorityDot.medium)} />
                <span className="text-xs text-slate-300 flex-1 truncate">{entry.taskName}</span>
                <input
                  type="number"
                  min="0"
                  max="9999"
                  step="1"
                  value={entry.daysTaken}
                  onChange={(e) => updateDays(entry.taskId, e.target.value)}
                  placeholder="Days"
                  className={cn(
                    'w-16 px-2 py-1 rounded text-xs text-center text-slate-200 placeholder-slate-600',
                    'bg-slate-700/50 border border-white/10 outline-none',
                    'focus:border-emerald-500/50 transition-all'
                  )}
                />
              </div>
            ))}
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
