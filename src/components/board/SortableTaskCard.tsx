'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { Calendar, Tag, MoreHorizontal, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'
import { GlowCard } from '@/components/ui/GlowCard'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'

interface SortableTaskCardProps {
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
  columnGlowColor: string
  showDropIndicator?: boolean
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

export function SortableTaskCard({ task, onEdit, columnGlowColor, showDropIndicator = false }: SortableTaskCardProps) {
  const { selectedTaskId, selectTask, labels } = useBoardStore()
  const { glowIntensity: globalGlow } = useThemeStore()
  const isSelected = selectedTaskId === task.id
  const mult = globalGlow / 75

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const taskLabels = labels.filter((l) => task.labels.includes(l.id))

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {showDropIndicator && globalGlow > 0 && (
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          className="absolute -top-1.5 left-0 right-0 h-1 rounded-full z-10"
          style={{
            background: `linear-gradient(90deg, transparent, ${columnGlowColor}, transparent)`,
            boxShadow: `0 0 ${20 * mult}px ${4 * mult}px ${columnGlowColor}, 0 0 ${40 * mult}px ${8 * mult}px ${columnGlowColor}`,
          }}
        />
      )}

      <motion.div
        {...attributes}
        {...listeners}
        onClick={() => selectTask(task.id)}
        onDoubleClick={onEdit}
        className={cn(
          'cursor-grab active:cursor-grabbing',
          isDragging && 'opacity-30 scale-95'
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: isDragging ? 0.3 : 1, y: 0, scale: isDragging ? 0.95 : 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
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
    </div>
  )
}
