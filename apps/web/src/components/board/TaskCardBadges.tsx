'use client'

import { Calendar, Clock } from 'lucide-react'
import { resolvePriority } from '@/lib/utils/priorities'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { DependencyIndicator } from './DependencyIndicator'
import { TaskSizeBadge } from './TaskSizeBadge'
import { StaleIndicator } from './StaleIndicator'
import { ForecastBadge } from './ForecastBadge'
import type { TaskCardTask } from './taskCardTypes'

// The card's footer meta row: priority + dependencies on the left, the
// status badges (forecast, stale, size, checklist tally, on-timeline) on the right.
export function TaskCardBadges({ task, onDependencyClick }: { task: TaskCardTask; onDependencyClick?: (taskId: string) => void }) {
  const priorities = useThemeStore((s) => s.priorities)
  const clSummary = useBoardStore((s) => s.checklistSummaries[task.id])
  const resolved = resolvePriority(priorities, task.priority)
  return (
    <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
      <div className="flex items-center gap-1.5">
        <span
          className="px-2 py-0.5 rounded-md text-xs font-medium"
          style={{ backgroundColor: `${resolved.color}33`, color: resolved.color }}
        >
          {resolved.name}
        </span>
        <DependencyIndicator
          taskId={task.id}
          onClick={() => onDependencyClick?.(task.id)}
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <ForecastBadge taskId={task.id} />
        <StaleIndicator updatedAt={task.updatedAt} status={task.status} />
        <TaskSizeBadge size={task.size} />
        {clSummary && clSummary.total > 0 && (
          <span className="text-[10px] font-mono tabular-nums">
            <span className="text-emerald-400">{clSummary.checked}</span>
            <span className="text-slate-600">/</span>
            <span className="text-red-400">{clSummary.crossed}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-500">{clSummary.total}</span>
          </span>
        )}
        {task.onTimeline && (
          <Calendar className="w-3 h-3 text-cyan-400" style={{ filter: 'drop-shadow(0 0 3px rgba(34,211,238,0.5))' }} />
        )}
      </div>
    </div>
  )
}

export function TaskCardDateRange({ startDate, endDate }: { startDate: string; endDate: string }) {
  const s = new Date(startDate)
  const e = new Date(endDate)
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)))
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  const sameDay = s.toDateString() === e.toDateString()
  return (
    <div className="flex items-center justify-end pt-1.5 mt-1.5 border-t border-white/5">
      <span className="flex items-center gap-1 text-[10px] text-slate-500 font-mono tabular-nums">
        <Clock className="w-2.5 h-2.5" />
        {sameDay ? `${fmt(s)} 1d` : `${fmt(s)}-${fmt(e)} ${days}d`}
      </span>
    </div>
  )
}
