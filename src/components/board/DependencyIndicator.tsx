'use client'

import { Lock, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'

interface DependencyIndicatorProps {
  taskId: string
  onClick?: () => void
}

export function DependencyIndicator({ taskId, onClick }: DependencyIndicatorProps) {
  const dependencies = useBoardStore((s) => s.dependencies)
  const tasks = useBoardStore((s) => s.tasks)

  const blockers = dependencies.filter((d) => d.blockedTaskId === taskId)
  const unresolvedBlockers = blockers.filter((d) => {
    const blocker = tasks.find((t) => t.id === d.blockerTaskId)
    return blocker && blocker.status !== 'done'
  })

  const blocking = dependencies.filter((d) => d.blockerTaskId === taskId)
  const isBlocked = unresolvedBlockers.length > 0
  const isBlocking = blocking.length > 0

  if (!isBlocked && !isBlocking) return null

  return (
    <div className="flex items-center gap-1.5">
      {isBlocked && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick?.()
          }}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium',
            'bg-red-500/20 text-red-400 border border-red-500/30',
            'hover:bg-red-500/30 transition-all duration-200',
            'animate-glow-pulse'
          )}
          style={{ '--glow-color': 'rgba(239, 68, 68, 0.4)' } as React.CSSProperties}
        >
          <Lock className="w-3 h-3" />
          Blocked ({unresolvedBlockers.length})
        </button>
      )}

      {isBlocking && !isBlocked && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClick?.()
          }}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium',
            'bg-amber-500/10 text-amber-400/70 border border-amber-500/20',
            'hover:bg-amber-500/20 transition-all duration-200'
          )}
        >
          <Link2 className="w-3 h-3" />
          Blocks ({blocking.length})
        </button>
      )}
    </div>
  )
}
