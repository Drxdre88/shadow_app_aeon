'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Tag, Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, colorConfig, generateId } from '@/lib/utils/colors'

interface LabelPickerProps {
  taskId: string
  projectId: string
  isOpen: boolean
  onClose: () => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
}

export function LabelPicker({ taskId, projectId, isOpen, onClose, onLabelCreate, onLabelToggle }: LabelPickerProps) {
  const [mounted, setMounted] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState<AccentColor>('purple')
  const menuRef = useRef<HTMLDivElement>(null)
  const { labels, tasks, addLabel, updateTask } = useBoardStore()

  const task = tasks.find((t) => t.id === taskId)
  const projectLabels = labels.filter((l) => l.projectId === projectId)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose])

  if (!mounted || !isOpen || !task) return null

  const handleToggleLabel = (labelId: string) => {
    const hasLabel = task.labels.includes(labelId)
    const newLabels = hasLabel
      ? task.labels.filter((id) => id !== labelId)
      : [...task.labels, labelId]
    updateTask(taskId, { labels: newLabels })
    onLabelToggle?.(taskId, labelId, hasLabel ? 'remove' : 'add')
  }

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) return
    const newLabel = {
      id: generateId(),
      projectId,
      name: newLabelName.trim(),
      color: newLabelColor,
    }
    addLabel(newLabel)
    onLabelCreate?.(newLabel)
    const newLabels = [...task.labels, newLabel.id]
    updateTask(taskId, { labels: newLabels })
    onLabelToggle?.(taskId, newLabel.id, 'add')
    setNewLabelName('')
    setIsCreating(false)
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
            'w-[420px] max-h-[500px] overflow-hidden',
            'rounded-xl',
            'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
            'shadow-[0_0_40px_rgba(0,0,0,0.6),0_0_15px_rgba(139,92,246,0.15)]',
            'flex flex-col'
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium text-white">Labels</span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {projectLabels.length === 0 && !isCreating && (
              <p className="text-xs text-slate-500 text-center py-4">No labels yet</p>
            )}

            {projectLabels.map((label) => {
              const isActive = task.labels.includes(label.id)
              const colors = colorConfig[label.color as AccentColor] ?? colorConfig.purple
              return (
                <button
                  key={label.id}
                  onClick={() => handleToggleLabel(label.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                    isActive ? 'bg-white/10' : 'hover:bg-white/5'
                  )}
                >
                  <div
                    className={cn('w-4 h-4 rounded flex-shrink-0 flex items-center justify-center', colors.bgSolid)}
                  >
                    {isActive && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className={cn('flex-1 text-left', isActive ? 'text-white font-medium' : 'text-slate-300')}>
                    {label.name}
                  </span>
                  <div className={cn('w-3 h-3 rounded-full', colors.bgSolid)} />
                </button>
              )
            })}

            {isCreating && (
              <div className="p-2 space-y-2 border-t border-white/10 mt-1">
                <input
                  type="text"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateLabel()
                    if (e.key === 'Escape') setIsCreating(false)
                  }}
                  placeholder="Label name..."
                  className="w-full px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  {ACCENT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewLabelColor(c)}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all',
                        newLabelColor === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                      )}
                      style={{ backgroundColor: colorConfig[c].hex }}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateLabel}
                    disabled={!newLabelName.trim()}
                    className="flex-1 px-3 py-1.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-400 text-sm font-medium hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setIsCreating(false)}
                    className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-slate-400 text-sm hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {!isCreating && (
            <div className="border-t border-white/10 p-2">
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create new label
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
