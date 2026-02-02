'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'

interface QuickAddTaskProps {
  projectId: string
  status: 'todo' | 'doing' | 'review' | 'done'
  onClose?: () => void
}

export function QuickAddTask({ projectId, status, onClose }: QuickAddTaskProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [taskName, setTaskName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { addTask, tasks } = useBoardStore()

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!taskName.trim()) return

    const maxOrder = Math.max(
      0,
      ...tasks.filter((t) => t.projectId === projectId && t.status === status).map((t) => t.orderIndex)
    )

    const generateId = () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID()
      }
      return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    }

    addTask({
      id: generateId(),
      projectId,
      name: taskName.trim(),
      status,
      priority: 'medium',
      color: 'purple',
      labels: [],
      onTimeline: false,
      orderIndex: maxOrder + 1,
    })

    setTaskName('')
    setIsOpen(false)
    onClose?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setTaskName('')
      onClose?.()
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'w-full p-3 rounded-xl text-sm font-medium',
          'bg-white/5 hover:bg-white/10',
          'border border-white/10 hover:border-white/20',
          'transition-all duration-200',
          'flex items-center justify-center gap-2',
          'text-slate-400 hover:text-slate-300'
        )}
      >
        <Plus className="w-4 h-4" />
        Add task
      </button>
    )
  }

  return (
    <AnimatePresence>
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={cn(
          'w-full p-3 rounded-xl',
          'bg-gradient-to-b from-white/10 to-black/30',
          'border border-white/20',
          'backdrop-blur-xl'
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Task name..."
          className={cn(
            'w-full px-3 py-2 rounded-lg',
            'bg-white/5 border border-white/10',
            'text-white placeholder-slate-500',
            'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
            'transition-all duration-200'
          )}
          autoComplete="off"
        />

        <div className="flex items-center gap-2 mt-2">
          <button
            type="submit"
            disabled={!taskName.trim()}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-lg text-sm font-medium',
              'bg-purple-500/20 hover:bg-purple-500/30',
              'border border-purple-500/30',
              'text-purple-400',
              'transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            Add
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              setTaskName('')
              onClose?.()
            }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm',
              'hover:bg-white/10',
              'text-slate-400 hover:text-slate-300',
              'transition-all duration-200'
            )}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-2">
          Press Enter to add, Esc to cancel
        </p>
      </motion.form>
    </AnimatePresence>
  )
}
