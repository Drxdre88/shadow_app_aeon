'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Package, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'
import { getArchivedTasks, restoreBoardTask } from '@/lib/actions/board'
import { useBoardStore } from '@/lib/store/boardStore'
import { GlowCard } from '@/components/ui/GlowCard'

interface ArchivedTask {
  id: string
  name: string
  description: string | null
  priority: string
  color: string
  status: string
  archivedAt: Date | null
}

interface ArchiveBrowserProps {
  isOpen: boolean
  projectId: string
  onClose: () => void
}

const priorityColors: Record<string, string> = {
  low: 'text-slate-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

export function ArchiveBrowser({ isOpen, projectId, onClose }: ArchiveBrowserProps) {
  const [tasks, setTasks] = useState<ArchivedTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    getArchivedTasks(projectId)
      .then((result) => setTasks(result as ArchivedTask[]))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [isOpen, projectId])

  const handleRestore = async (taskId: string) => {
    setRestoringIds((prev) => new Set(prev).add(taskId))
    try {
      const restored = await restoreBoardTask(taskId, projectId)
      if (restored) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        const { addTask } = useBoardStore.getState()
        addTask({
          id: restored.id,
          projectId: restored.projectId,
          name: restored.name,
          description: restored.description || undefined,
          columnId: restored.columnId || undefined,
          status: restored.status,
          priority: restored.priority as 'low' | 'medium' | 'high' | 'urgent',
          color: restored.color,
          labels: [],
          onTimeline: restored.onTimeline,
          size: restored.size ?? null,
          orderIndex: restored.orderIndex,
        })
      }
    } catch (err) {
      console.error('Failed to restore task:', err)
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    }
  }

  if (!isOpen) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="w-full max-w-lg max-h-[70vh] flex flex-col rounded-2xl border overflow-hidden"
          style={{
            background: 'linear-gradient(to bottom, rgba(20, 20, 32, 0.98), rgba(12, 12, 20, 0.99))',
            borderColor: colors.glowColor.replace(/[\d.]+\)$/, '0.15)'),
            boxShadow: `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor.replace(/[\d.]+\)$/, '0.15)')}`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white">Archive</h2>
              <span className="text-xs text-slate-500">{tasks.length} tasks</span>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
                Loading archived tasks...
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
                <Package className="w-10 h-10 opacity-30" />
                <p className="text-sm">No archived tasks</p>
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm font-medium text-white truncate">{task.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-xs font-medium', priorityColors[task.priority] || 'text-slate-400')}>
                        {task.priority}
                      </span>
                      {task.archivedAt && (
                        <span className="text-[10px] text-slate-600">
                          {new Date(task.archivedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(task.id)}
                    disabled={restoringIds.has(task.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      restoringIds.has(task.id)
                        ? 'text-slate-600 cursor-not-allowed'
                        : 'text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30'
                    )}
                  >
                    <RotateCcw className={cn('w-3.5 h-3.5', restoringIds.has(task.id) && 'animate-spin')} />
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
