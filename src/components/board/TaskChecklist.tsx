'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, X, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils/cn'

interface ChecklistItem {
  id: string
  title: string
  completed: boolean
  startDate?: string
  endDate?: string
}

interface TaskChecklistProps {
  taskId: string
  items: ChecklistItem[]
  onItemAdd?: (title: string) => void
  onItemToggle?: (itemId: string) => void
  onItemRemove?: (itemId: string) => void
  onItemUpdateDates?: (itemId: string, startDate?: string, endDate?: string) => void
}

export function TaskChecklist({
  taskId,
  items,
  onItemAdd,
  onItemToggle,
  onItemRemove,
  onItemUpdateDates,
}: TaskChecklistProps) {
  const [isAddingItem, setIsAddingItem] = useState(false)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [editingDates, setEditingDates] = useState<string | null>(null)

  const completedCount = items.filter((item) => item.completed).length
  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemTitle.trim()) return

    onItemAdd?.(newItemTitle.trim())
    setNewItemTitle('')
    setIsAddingItem(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsAddingItem(false)
      setNewItemTitle('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-white">Checklist</h3>
          <span className="text-xs text-slate-500">
            {completedCount}/{items.length}
          </span>
        </div>

        {!isAddingItem && (
          <button
            onClick={() => setIsAddingItem(true)}
            className={cn(
              'p-1.5 rounded-lg text-slate-400 hover:text-slate-300',
              'hover:bg-white/10 transition-all duration-200'
            )}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-1">
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-xs text-slate-500 text-right">{Math.round(progress)}% complete</p>
        </div>
      )}

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={cn(
                'group p-3 rounded-lg border transition-all duration-200',
                'bg-white/5 border-white/10',
                item.completed && 'opacity-60'
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  onClick={() => onItemToggle?.(item.id)}
                  className={cn(
                    'flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-200',
                    'flex items-center justify-center',
                    item.completed
                      ? 'bg-purple-500 border-purple-500'
                      : 'border-white/30 hover:border-white/50'
                  )}
                >
                  {item.completed && <Check className="w-3 h-3 text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm transition-all duration-200',
                      item.completed
                        ? 'line-through text-slate-500'
                        : 'text-slate-300'
                    )}
                  >
                    {item.title}
                  </p>

                  {(item.startDate || item.endDate) && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                      <Calendar className="w-3 h-3" />
                      {item.startDate && format(new Date(item.startDate), 'MMM d')}
                      {item.startDate && item.endDate && ' - '}
                      {item.endDate && format(new Date(item.endDate), 'MMM d')}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => onItemRemove?.(item.id)}
                  className={cn(
                    'flex-shrink-0 p-1 rounded text-slate-500 hover:text-red-400',
                    'hover:bg-red-500/10 transition-all duration-200',
                    'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {isAddingItem && (
        <motion.form
          onSubmit={handleAddItem}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'p-3 rounded-lg border',
            'bg-white/5 border-white/20'
          )}
        >
          <input
            type="text"
            value={newItemTitle}
            onChange={(e) => setNewItemTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Item title..."
            className={cn(
              'w-full px-3 py-2 rounded-lg mb-2',
              'bg-white/5 border border-white/10',
              'text-white placeholder-slate-500',
              'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
              'transition-all duration-200'
            )}
            autoFocus
            autoComplete="off"
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!newItemTitle.trim()}
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
                setIsAddingItem(false)
                setNewItemTitle('')
              }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm',
                'hover:bg-white/10',
                'text-slate-400 hover:text-slate-300',
                'transition-all duration-200'
              )}
            >
              Cancel
            </button>
          </div>
        </motion.form>
      )}
    </div>
  )
}
