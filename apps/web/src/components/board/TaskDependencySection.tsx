'use client'

import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lock, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'
import { useBoardStore } from '@/lib/store/boardStore'

interface TaskDependencySectionProps {
  taskId: string
  projectId: string
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
}

export function TaskDependencySection({
  taskId,
  projectId,
  onAddDependency,
  onRemoveDependency,
}: TaskDependencySectionProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const tasks = useBoardStore((s) => s.tasks)
  const dependencies = useBoardStore((s) => s.dependencies)

  const blockers = useMemo(
    () => dependencies
      .filter((d) => d.blockedTaskId === taskId)
      .map((d) => tasks.find((t) => t.id === d.blockerTaskId))
      .filter(Boolean),
    [dependencies, taskId, tasks]
  )

  const existingBlockerIds = useMemo(
    () => new Set(dependencies.filter((d) => d.blockedTaskId === taskId).map((d) => d.blockerTaskId)),
    [dependencies, taskId]
  )

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    return tasks
      .filter((t) =>
        t.projectId === projectId &&
        t.id !== taskId &&
        !existingBlockerIds.has(t.id) &&
        t.name.toLowerCase().includes(query)
      )
      .slice(0, 5)
  }, [tasks, searchQuery, projectId, taskId, existingBlockerIds])

  const handleAdd = useCallback((blockerTaskId: string) => {
    onAddDependency?.(blockerTaskId, taskId)
    setSearchQuery('')
    setIsAdding(false)
  }, [onAddDependency, taskId])

  const handleRemove = useCallback((blockerTaskId: string) => {
    onRemoveDependency?.(blockerTaskId, taskId)
  }, [onRemoveDependency, taskId])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-medium text-white">Blocked By</h3>
          {blockers.length > 0 && (
            <span className="text-xs text-slate-500">{blockers.length}</span>
          )}
        </div>

        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-300 hover:bg-white/10 transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {blockers.map((blocker) => {
          if (!blocker) return null
          const colors = colorConfig[blocker.color as AccentColor] || colorConfig.purple
          return (
            <motion.div
              key={blocker.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={cn(
                'group flex items-center gap-2 p-2 rounded-lg',
                'bg-white/5 border border-white/10',
                'transition-all duration-200'
              )}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: colors.hex }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-300 truncate">{blocker.name}</p>
                <p className="text-xs text-slate-500 capitalize">{blocker.status}</p>
              </div>
              <button
                onClick={() => handleRemove(blocker.id)}
                className={cn(
                  'flex-shrink-0 p-1 rounded text-slate-500 hover:text-red-400',
                  'hover:bg-red-500/10 transition-all duration-200',
                  'opacity-0 group-hover:opacity-100'
                )}
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>

      {isAdding && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks to add as blocker..."
              className={cn(
                'w-full pl-9 pr-8 py-2 rounded-lg text-sm',
                'bg-white/5 border border-white/10',
                'text-white placeholder-slate-500',
                'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                'transition-all duration-200'
              )}
              autoFocus
            />
            <button
              onClick={() => {
                setIsAdding(false)
                setSearchQuery('')
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10"
            >
              <X className="w-3 h-3 text-slate-400" />
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
              {searchResults.map((task) => {
                const colors = colorConfig[task.color as AccentColor] || colorConfig.purple
                return (
                  <button
                    key={task.id}
                    onClick={() => handleAdd(task.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left',
                      'hover:bg-white/10 transition-colors',
                      'border-b border-white/5 last:border-b-0'
                    )}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: colors.hex }}
                    />
                    <span className="text-sm text-slate-300 truncate">{task.name}</span>
                    <span className="text-xs text-slate-500 capitalize ml-auto flex-shrink-0">
                      {task.status}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {searchQuery.trim() && searchResults.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-2">No matching tasks found</p>
          )}
        </motion.div>
      )}
    </div>
  )
}
