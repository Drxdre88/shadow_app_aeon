'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { ListTodo, Activity, Eye, CheckCircle2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SortableTaskCard } from './SortableTaskCard'
import { AccentColor } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'

type TaskStatus = 'todo' | 'doing' | 'review' | 'done'

interface KanbanColumnProps {
  status: TaskStatus
  tasks: Array<{
    id: string
    name: string
    description?: string
    color: AccentColor
    priority: 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    startDate?: string
    endDate?: string
    onTimeline: boolean
  }>
  onTaskEdit?: (taskId: string) => void
  onAddTask?: () => void
  overId?: string | null
  activeTaskId?: string | null
}

const statusConfig = {
  todo: {
    icon: ListTodo,
    label: 'Todo',
    color: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    glow: 'shadow-[0_0_10px_rgba(236,72,153,0.3)]',
    glowColor: 'rgba(236,72,153,0.6)',
  },
  doing: {
    icon: Activity,
    label: 'Doing',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]',
    glowColor: 'rgba(59,130,246,0.6)',
  },
  review: {
    icon: Eye,
    label: 'Review',
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    glow: 'shadow-[0_0_10px_rgba(168,85,247,0.3)]',
    glowColor: 'rgba(168,85,247,0.6)',
  },
  done: {
    icon: CheckCircle2,
    label: 'Done',
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    glow: 'shadow-[0_0_10px_rgba(16,185,129,0.3)]',
    glowColor: 'rgba(16,185,129,0.6)',
  },
}

export function KanbanColumn({ status, tasks, onTaskEdit, onAddTask, overId, activeTaskId }: KanbanColumnProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const { glowIntensity: globalGlow } = useThemeStore()
  const mult = globalGlow / 75

  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  })

  const taskIds = tasks.map((t) => t.id)

  const dynamicGlow = globalGlow > 0
    ? { boxShadow: config.glow.replace(/0_0_(\d+)px/g, (_, num) => `0_0_${Math.round(parseInt(num) * mult)}px`) }
    : {}

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col h-full min-w-[300px] rounded-xl',
        'glass transition-all duration-200',
        isOver && 'ring-2 ring-white/20'
      )}
    >
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
              'border backdrop-blur-md',
              config.color,
              globalGlow > 0 && config.glow
            )}
            style={dynamicGlow}
          >
            <Icon className="w-4 h-4" />
            <span>{config.label}</span>
            <span className="font-bold">{tasks.length}</span>
          </div>

          <button
            onClick={onAddTask}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <Plus className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onEdit={() => onTaskEdit?.(task.id)}
                columnGlowColor={config.glowColor}
                showDropIndicator={overId === task.id && activeTaskId !== task.id}
              />
            ))}
          </AnimatePresence>
        </SortableContext>
      </div>
    </div>
  )
}
