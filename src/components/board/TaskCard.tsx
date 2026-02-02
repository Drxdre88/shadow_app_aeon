'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { Calendar, Tag, MoreHorizontal, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'
import { GlowCard } from '@/components/ui/GlowCard'
import { useBoardStore } from '@/lib/store/boardStore'

interface TaskCardProps {
  task: {
    id: string
    name: string
    description?: string
    color: AccentColor
    priority: 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    startDate?: string
    endDate?: string
    onTimeline: boolean
  }
  onEdit?: () => void
}

const priorityColors = {
  low: 'bg-slate-500/20 text-slate-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  urgent: 'bg-red-500/20 text-red-400',
}

const priorityGlows = {
  low: 'none' as const,
  medium: 'sm' as const,
  high: 'md' as const,
  urgent: 'lg' as const,
}

export function TaskCard({ task, onEdit }: TaskCardProps) {
  const { selectedTaskId, selectTask, labels } = useBoardStore()
  const isSelected = selectedTaskId === task.id
  const colors = colorConfig[task.color]

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', task },
  })

  const dragStyle = transform ? {
    transform: CSS.Translate.toString(transform),
  } : undefined

  const taskLabels = labels.filter((l) => task.labels.includes(l.id))

  return (
    <motion.div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => selectTask(task.id)}
      onDoubleClick={onEdit}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-70 z-50'
      )}
      style={dragStyle}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
    >
      <GlowCard
        accentColor={task.color}
        glowIntensity={priorityGlows[task.priority]}
        showAccentLine
        selected={isSelected}
        hover
        className="p-3 group"
      >
        <div className="flex items-start justify-between mb-2">
          {taskLabels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {taskLabels.map((label) => {
                const labelColors = colorConfig[label.color as AccentColor]
                return (
                  <span
                    key={label.id}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-xs font-medium flex items-center gap-1',
                      'backdrop-blur-md border',
                      labelColors.bg,
                      labelColors.border,
                      labelColors.text
                    )}
                  >
                    <Tag className="w-3 h-3" />
                    {label.name}
                  </span>
                )
              })}
            </div>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.() }}
            className="p-1 rounded-md hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <h4 className="text-sm font-medium text-white mb-2 line-clamp-2">
          {task.name}
        </h4>

        {task.description && (
          <p className="text-xs text-slate-400 mb-3 line-clamp-2">
            {task.description}
          </p>
        )}

        <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
          <span className={cn(
            'px-2 py-0.5 rounded-md text-xs font-medium',
            priorityColors[task.priority]
          )}>
            {task.priority}
          </span>

          {(task.startDate || task.endDate) && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              {task.startDate && format(new Date(task.startDate), 'MMM d')}
              {task.startDate && task.endDate && ' - '}
              {task.endDate && format(new Date(task.endDate), 'MMM d')}
            </div>
          )}

          {task.onTimeline && (
            <div className="flex items-center gap-1 text-xs text-cyan-400">
              <Calendar className="w-3 h-3" />
              On timeline
            </div>
          )}
        </div>
      </GlowCard>
    </motion.div>
  )
}
