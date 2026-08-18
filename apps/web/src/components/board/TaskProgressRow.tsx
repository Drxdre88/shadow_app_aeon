'use client'

import { useState } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import { ProgressControl } from './ProgressControl'

interface TaskProgressRowProps {
  taskId: string
  onProgressChange?: (taskId: string, progress: number | null) => void
}

// Mounted with key={taskId} by the modal, so the draft re-seeds on card switch
// without an effect.
export function TaskProgressRow({ taskId, onProgressChange }: TaskProgressRowProps) {
  const stored = useBoardStore((s) => s.tasks.find((t) => t.id === taskId)?.progress ?? null)
  const updateTask = useBoardStore((s) => s.updateTask)
  const [value, setValue] = useState(stored ?? 0)

  const commit = (next: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(next)))
    if (clamped === stored) return
    updateTask(taskId, { progress: clamped })
    onProgressChange?.(taskId, clamped)
  }

  const clear = () => {
    setValue(0)
    if (stored === null) return
    updateTask(taskId, { progress: null })
    onProgressChange?.(taskId, null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm text-slate-400">Progress</label>
        {stored !== null && (
          <button
            onClick={clear}
            className="text-[11px] text-slate-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <ProgressControl value={value} onChange={setValue} onCommit={commit} />
    </div>
  )
}
