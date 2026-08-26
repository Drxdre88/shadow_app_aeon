'use client'

import { useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, CalendarDays, Users } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { sortLabelsByName } from '@/lib/utils/labels'
import { priorityActiveStyle } from '@/lib/utils/priorities'
import type { BoardFilters } from '@/lib/utils/boardFilters'

interface BoardFilterBarProps {
  isOpen: boolean
  filters: BoardFilters
  onFiltersChange: (filters: BoardFilters) => void
}

const DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'has-dates', label: 'Has Dates' },
  { value: 'no-dates', label: 'No Dates' },
  { value: 'overdue', label: 'Overdue' },
] as const

type FilterPerson = { id: string; name: string; virtual: boolean; color: string | null }

export function BoardFilterBar({ isOpen, filters, onFiltersChange }: BoardFilterBarProps) {
  const labels = sortLabelsByName(useBoardStore((s) => s.labels))
  const priorities = useThemeStore((s) => s.priorities)
  const virtualMembers = useBoardStore((s) => s.virtualMembers)
  const assigneesByTask = useBoardStore((s) => s.assigneesByTask)

  // People you can filter by: every virtual member of the realm, plus every
  // real user currently assigned somewhere on this board (no extra fetch).
  const people = useMemo<FilterPerson[]>(() => {
    const byId = new Map<string, FilterPerson>()
    for (const list of Object.values(assigneesByTask)) {
      for (const pill of list) {
        if (pill.kind === 'virtual') continue
        if (!byId.has(pill.userId)) {
          byId.set(pill.userId, { id: pill.userId, name: pill.name ?? 'Unknown', virtual: false, color: null })
        }
      }
    }
    const real = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
    const virtual = virtualMembers.map((v) => ({ id: v.id, name: v.name, virtual: true, color: v.color as string | null }))
    return [...real, ...virtual]
  }, [assigneesByTask, virtualMembers])

  const toggleAssignee = useCallback((id: string) => {
    const next = new Set(filters.assignees)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onFiltersChange({ ...filters, assignees: next })
  }, [filters, onFiltersChange])

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
      assignees: new Set(),
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
                  'focus:outline-none focus:ring-2 focus:ring-white/20',
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
                {priorities.map((p) => {
                  const isActive = filters.priorities.has(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePriority(p.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium capitalize',
                        'border transition-all duration-200'
                      )}
                      style={isActive
                        ? priorityActiveStyle(p.color)
                        : {
                            backgroundColor: hexToRgba(p.color, 0.12),
                            borderColor: hexToRgba(p.color, 0.3),
                            color: hexToRgba(p.color, 0.85),
                          }}
                    >
                      {p.name}
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

            {people.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">
                  <Users className="w-3 h-3 inline mr-1" />
                  Assignees
                </label>
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => {
                    const isActive = filters.assignees.has(p.id)
                    const hex = p.virtual
                      ? (colorConfig[(p.color ?? 'purple') as AccentColor] as { hex: string } | undefined)?.hex ?? colorConfig.purple.hex
                      : null
                    return (
                      <button
                        key={p.id}
                        onClick={() => toggleAssignee(p.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium',
                          'border transition-all duration-200',
                          isActive
                            ? 'bg-white/15 border-white/30 text-white ring-1 ring-white/20'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                        )}
                      >
                        <span
                          className={cn(
                            'w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[7px] font-semibold text-white',
                            p.virtual ? 'border border-dashed border-white/50' : 'border border-white/20'
                          )}
                          style={hex
                            ? { background: `linear-gradient(135deg, ${hex}cc, ${hex}66)` }
                            : { background: 'rgba(255,255,255,0.12)' }}
                        >
                          {p.name.trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?'}
                        </span>
                        {p.name}
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
                      filters.dateFilter !== value && 'text-slate-400 hover:text-white hover:bg-white/5'
                    )}
                    style={filters.dateFilter === value ? {
                      backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                      color: 'var(--primary)',
                      boxShadow: '0 0 10px var(--glow-color)',
                    } : undefined}
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
