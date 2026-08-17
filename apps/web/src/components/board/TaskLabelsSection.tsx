'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { hexToRgba } from '@/lib/utils/colors'
import { labelHex, readableTextColor } from './labelTile'
import { LabelPicker } from './LabelPicker'

interface TaskLabelsSectionProps {
  taskId: string
  projectId: string
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
}

export function TaskLabelsSection({ taskId, projectId, onLabelToggle }: TaskLabelsSectionProps) {
  const labels = useBoardStore((s) => s.labels)
  const tasks = useBoardStore((s) => s.tasks)
  const updateTask = useBoardStore((s) => s.updateTask)
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)

  const task = tasks.find((t) => t.id === taskId)
  const taskLabels = task?.labels ?? []
  const projectLabels = labels.filter((l) => l.projectId === projectId)
  const appliedLabels = projectLabels.filter((l) => taskLabels.includes(l.id))

  const handleRemove = (labelId: string) => {
    updateTask(taskId, { labels: taskLabels.filter((id) => id !== labelId) })
    onLabelToggle?.(taskId, labelId, 'remove')
  }

  return (
    <div className="pt-4 border-t border-white/10">
      <label className="block text-sm text-slate-400 mb-2">Labels</label>
      <div className="flex flex-wrap items-center gap-1.5">
        {appliedLabels.map((label) => {
          const hex = labelHex(label.color)
          const fg = readableTextColor(hex)
          return (
            <button
              key={label.id}
              onClick={() => handleRemove(label.id)}
              title={`Remove "${label.name}"`}
              className={cn(
                'group flex items-center gap-1 px-2.5 py-1 rounded-md',
                'text-xs font-medium border transition-all duration-150 hover:brightness-110'
              )}
              style={{
                backgroundColor: hex,
                borderColor: hexToRgba(hex, 0.6),
                color: fg,
                boxShadow: `0 0 8px ${hexToRgba(hex, 0.35)}`,
              }}
            >
              {label.name}
              <X className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
            </button>
          )
        })}
        <button
          onClick={() => setLabelPickerOpen(true)}
          title={projectLabels.length === 0 ? 'Create a label' : 'Add or manage labels'}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs',
            'bg-white/5 border border-dashed border-white/20 text-slate-400',
            'hover:bg-white/10 hover:text-white hover:border-white/30 transition-all'
          )}
        >
          <Plus className="w-3 h-3" />
          {appliedLabels.length === 0 && (projectLabels.length === 0 ? 'Create label' : 'Add label')}
        </button>
      </div>
      <LabelPicker
        taskId={taskId}
        projectId={projectId}
        isOpen={labelPickerOpen}
        onClose={() => setLabelPickerOpen(false)}
        onLabelToggle={onLabelToggle}
      />
    </div>
  )
}
