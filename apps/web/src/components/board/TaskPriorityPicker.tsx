'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { hexToRgba } from '@/lib/utils/colors'

interface TaskPriorityPickerProps {
  taskId: string
  isOpen: boolean
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
}

export function TaskPriorityPicker({ taskId, isOpen, onClose, onTaskUpdate }: TaskPriorityPickerProps) {
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { tasks, updateTask } = useBoardStore()
  const { priorities } = useThemeStore()
  const task = tasks.find((t) => t.id === taskId)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose])

  if (!mounted || !isOpen || !task) return null

  const handleSelect = (priorityId: 'low' | 'medium' | 'high' | 'urgent') => {
    updateTask(taskId, { priority: priorityId })
    onTaskUpdate?.(taskId, { priority: priorityId })
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-[260px] overflow-hidden rounded-xl',
            'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
            'shadow-[0_0_40px_rgba(0,0,0,0.6),0_0_15px_rgba(139,92,246,0.15)]',
            'flex flex-col'
          )}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-medium text-white">Priority</span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 space-y-1">
            {priorities.map((p) => {
              const isActive = task.priority === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p.id as 'low' | 'medium' | 'high' | 'urgent')}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                    'border text-sm font-medium',
                    !isActive && 'border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-300'
                  )}
                  style={isActive ? {
                    backgroundColor: hexToRgba(p.color, 0.2),
                    borderColor: hexToRgba(p.color, 0.3),
                    color: p.color,
                    boxShadow: `0 0 10px ${hexToRgba(p.color, 0.4)}`,
                  } : undefined}
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="capitalize">{p.name}</span>
                </button>
              )
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
