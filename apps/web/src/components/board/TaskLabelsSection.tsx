'use client'

import { useState } from 'react'
import { Tag, Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { LabelPicker } from './LabelPicker'

interface TaskLabelsSectionProps {
  taskId: string
  projectId: string
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
}

export function TaskLabelsSection({ taskId, projectId, onLabelToggle }: TaskLabelsSectionProps) {
  const { labels, tasks } = useBoardStore()
  const [labelPickerOpen, setLabelPickerOpen] = useState(false)

  const task = tasks.find((t) => t.id === taskId)
  const taskLabels = task?.labels ?? []
  const projectLabels = labels.filter((l) => l.projectId === projectId)
  const appliedLabels = projectLabels.filter((l) => taskLabels.includes(l.id))

  return (
    <div className="pt-4 border-t border-white/10">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm text-slate-400">Labels</label>
        <button
          onClick={() => setLabelPickerOpen(true)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md text-xs',
            'bg-white/5 border border-white/10 text-slate-400',
            'hover:bg-white/10 hover:text-white transition-all'
          )}
        >
          <Plus className="w-3 h-3" />
          {projectLabels.length === 0 ? 'Create label' : 'Manage'}
        </button>
      </div>
      {appliedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {appliedLabels.map((label) => {
            const lc = colorConfig[label.color as AccentColor]
            const isCustom = !lc
            const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
            return (
              <span
                key={label.id}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5',
                  'border',
                  !isCustom && lc?.bg, !isCustom && lc?.border, !isCustom && lc?.text,
                  isCustom && 'text-white'
                )}
                style={isCustom ? {
                  backgroundColor: hexToRgba(hex, 0.15),
                  borderColor: hexToRgba(hex, 0.3),
                  color: hex,
                } : undefined}
              >
                <Tag className="w-3 h-3" />
                {label.name}
              </span>
            )
          })}
        </div>
      )}
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
