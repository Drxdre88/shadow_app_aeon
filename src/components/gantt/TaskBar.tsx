'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'
import { useGanttStore } from '@/lib/store/ganttStore'

interface TaskBarProps {
  task: {
    id: string
    name: string
    color: AccentColor
    progress: number
  }
  style: {
    left: number
    width: number
    top: number
  }
}

export function TaskBar({ task, style }: TaskBarProps) {
  const { selectedTaskId, selectTask } = useGanttStore()
  const isSelected = selectedTaskId === task.id
  const colors = colorConfig[task.color]

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', task },
  })

  const dragStyle = transform ? {
    transform: CSS.Translate.toString(transform),
  } : undefined

  const glowStyle = useMemo(() => ({
    boxShadow: isSelected
      ? `0 0 30px 10px ${colors.glow}`
      : `0 0 15px 3px ${colors.glowDark}`,
  }), [isSelected, colors])

  return (
    <motion.div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => selectTask(task.id)}
      className={cn(
        'absolute h-10 rounded-lg cursor-grab active:cursor-grabbing group',
        'backdrop-blur-md border transition-all duration-200',
        colors.border,
        isDragging && 'opacity-80 z-50',
        isSelected && 'ring-2 ring-offset-2 ring-offset-background'
      )}
      style={{
        left: `${style.left}px`,
        width: `${style.width}px`,
        top: `${style.top}px`,
        background: `linear-gradient(to right, ${colors.hex}cc, ${colors.hex}99)`,
        ...glowStyle,
        ...dragStyle,
      }}
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-center h-full px-3">
        <span className="text-sm font-medium text-white truncate drop-shadow-md">
          {task.name}
        </span>
      </div>

      {task.progress > 0 && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-white/50 rounded-b-lg transition-all duration-300"
          style={{ width: `${task.progress}%` }}
        />
      )}

      <div
        className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-6 rounded-full bg-white/30
                   cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </motion.div>
  )
}
