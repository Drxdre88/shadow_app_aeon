'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'

interface TaskDateSectionProps {
  taskId: string
  onDateChange?: (taskId: string, dates: { startDate?: string | null; endDate?: string | null }) => void
}

const dateInputClass = cn(
  'flex-1 px-3 py-2 rounded-lg text-sm',
  'bg-white/5 border border-white/10',
  'text-white',
  'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
  'transition-all duration-200',
  '[color-scheme:dark]'
)

export function TaskDateSection({ taskId, onDateChange }: TaskDateSectionProps) {
  const { tasks, updateTask } = useBoardStore()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null

  const startIso = task.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : ''
  const endIso = task.endDate ? new Date(task.endDate).toISOString().slice(0, 10) : ''

  const handleStartChange = (val: string) => {
    const start = val ? new Date(val + 'T00:00:00').toISOString() : null
    const autoEnd = start && !endIso ? start : undefined
    updateTask(taskId, {
      startDate: start ?? undefined,
      ...(autoEnd ? { endDate: autoEnd } : {}),
    })
    onDateChange?.(taskId, {
      startDate: start,
      ...(autoEnd ? { endDate: autoEnd } : {}),
    })
  }

  const handleEndChange = (val: string) => {
    const end = val ? new Date(val + 'T00:00:00').toISOString() : null
    const autoStart = end && !startIso ? end : undefined
    updateTask(taskId, {
      endDate: end ?? undefined,
      ...(autoStart ? { startDate: autoStart } : {}),
    })
    onDateChange?.(taskId, {
      endDate: end,
      ...(autoStart ? { startDate: autoStart } : {}),
    })
  }

  const handleClear = () => {
    updateTask(taskId, { startDate: undefined, endDate: undefined })
    onDateChange?.(taskId, { startDate: null, endDate: null })
  }

  const durationLabel = (() => {
    if (!startIso || !endIso) return null
    const s = new Date(startIso)
    const e = new Date(endIso)
    const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)))
    return s.toDateString() === e.toDateString() ? '1 day' : `${days} days`
  })()

  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">Dates</label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={startIso}
          onChange={(e) => handleStartChange(e.target.value)}
          className={dateInputClass}
        />
        <span className="text-slate-500 text-xs">to</span>
        <input
          type="date"
          value={endIso}
          onChange={(e) => handleEndChange(e.target.value)}
          className={dateInputClass}
        />
        {(startIso || endIso) && (
          <button
            onClick={handleClear}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors"
            title="Clear dates"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {durationLabel && (
        <p className="text-xs text-slate-500 mt-1">{durationLabel}</p>
      )}
    </div>
  )
}
