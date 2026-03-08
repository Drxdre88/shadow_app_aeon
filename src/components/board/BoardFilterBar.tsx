'use client'

import { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'
import { useBoardStore } from '@/lib/store/boardStore'
import type { BoardFilters } from '@/lib/utils/boardFilters'

interface BoardFilterBarProps {
  isOpen: boolean
  filters: BoardFilters
  onFiltersChange: (filters: BoardFilters) => void
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const priorityColors: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const priorityActiveColors: Record<string, string> = {
  low: 'bg-slate-500/40 text-slate-300 border-slate-400/50 shadow-[0_0_10px_rgba(148,163,184,0.3)]',
  medium: 'bg-blue-500/40 text-blue-300 border-blue-400/50 shadow-[0_0_10px_rgba(59,130,246,0.3)]',
  high: 'bg-orange-500/40 text-orange-300 border-orange-400/50 shadow-[0_0_10px_rgba(249,115,22,0.3)]',
  urgent: 'bg-red-500/40 text-red-300 border-red-400/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]',
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'has-dates', label: 'Has Dates' },
  { value: 'no-dates', label: 'No Dates' },
  { value: 'overdue', label: 'Overdue' },
] as const

export function BoardFilterBar({ isOpen, filters, onFiltersChange }: BoardFilterBarProps) {
  const labels = useBoardStore((s) => s.labels)

  const togglePriority = useCallback((priority: string) => {
    const next = new Set(filters.priorities)
    if (next.has(priority)) next.delete(priority)
    else next.add(priority)
    onFiltersChange({ ...filters, priorities: next })
  }, [filters, onFiltersChange])

  const toggleLabel = useCallback((labelId: string) => {
    const next = new Set(filters.labels)
    if (next.has(labelId)) next.delete(labelId)
    else next.add(labelId)
    onFiltersChange({ ...filters, labels: next })
  }, [filters, onFiltersChange])

  const clearAll = useCallback(() => {
    onFiltersChange({
      search: '',
      priorities: new Set(),
      labels: new Set(),
      dateFilter: 'all',
    })
  }, [onFiltersChange])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-4 overflow-hidden"
        >
          <div className="p-4 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                placeholder="Search tasks..."
                className={cn(
                  'w-full pl-10 pr-4 py-2 rounded-lg',
                  'bg-white/5 border border-white/10',
                  'text-white placeholder-slate-500 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                  'transition-all duration-200'
                )}
              />
              {filters.search && (
                <button
                  onClick={() => onFiltersChange({ ...filters, search: '' })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10"
                >
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Priority</label>
              <div className="flex gap-2">
                {PRIORITIES.map((priority) => {
                  const isActive = filters.priorities.has(priority)
                  return (
                    <button
                      key={priority}
                      onClick={() => togglePriority(priority)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                        'border transition-all duration-200',
                        isActive ? priorityActiveColors[priority] : priorityColors[priority]
                      )}
                    >
                      {priority}
                    </button>
                  )
                })}
              </div>
            </div>

            {labels.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Labels</label>
                <div className="flex flex-wrap gap-2">
                  {labels.map((label) => {
                    const isActive = filters.labels.has(label.id)
                    const colors = colorConfig[label.color as AccentColor]
                    return (
                      <button
                        key={label.id}
                        onClick={() => toggleLabel(label.id)}
                        className={cn(
                          'px-3 py-1 rounded-lg text-xs font-medium',
                          'border transition-all duration-200',
                          isActive
                            ? `${colors.bg} ${colors.text} ${colors.border} ring-1 ${colors.ring}`
                            : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                        )}
                      >
                        {label.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">
                <CalendarDays className="w-3 h-3 inline mr-1" />
                Date Filter
              </label>
              <div className="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
                {DATE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => onFiltersChange({ ...filters, dateFilter: value as BoardFilters['dateFilter'] })}
                    className={cn(
                      'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
                      filters.dateFilter === value
                        ? 'bg-purple-500/20 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={clearAll}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200"
              >
                Clear All
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
