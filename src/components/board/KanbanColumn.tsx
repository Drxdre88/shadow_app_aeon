'use client'

import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { ListTodo, Activity, Eye, CheckCircle2, Plus, Columns3, GripVertical, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SortableTaskCard } from './SortableTaskCard'
import { QuickAddTask } from './QuickAddTask'
import { AccentColor, colorConfig } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import type { BoardColumn } from '@/lib/store/boardStore'

interface KanbanColumnProps {
  column: BoardColumn
  projectId: string
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
  onTaskCreate?: (task: {
    id: string
    projectId: string
    name: string
    columnId: string
    status: string
    priority: string
    color: string
    labels: string[]
    onTimeline: boolean
    orderIndex: number
  }) => void
  onColumnRename?: (columnId: string, name: string) => void
  overId?: string | null
  activeTaskId?: string | null
  onDependencyClick?: (taskId: string) => void
  dragHandleProps?: Record<string, unknown>
}

const ICON_MAP: Record<string, typeof ListTodo> = {
  'list-todo': ListTodo,
  'activity': Activity,
  'eye': Eye,
  'check-circle': CheckCircle2,
}

function getColumnColor(color: string) {
  const colorMap: Record<string, { bg: string; text: string; border: string; glow: string; glowColor: string }> = {
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30', glow: 'shadow-[0_0_10px_rgba(236,72,153,0.3)]', glowColor: 'rgba(236,72,153,0.6)' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]', glowColor: 'rgba(59,130,246,0.6)' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', glow: 'shadow-[0_0_10px_rgba(168,85,247,0.3)]', glowColor: 'rgba(168,85,247,0.6)' },
    green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.3)]', glowColor: 'rgba(16,185,129,0.6)' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', glow: 'shadow-[0_0_10px_rgba(34,211,238,0.3)]', glowColor: 'rgba(34,211,238,0.6)' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-[0_0_10px_rgba(249,115,22,0.3)]', glowColor: 'rgba(249,115,22,0.6)' },
    red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-[0_0_10px_rgba(239,68,68,0.3)]', glowColor: 'rgba(239,68,68,0.6)' },
  }
  return colorMap[color] || colorMap.purple
}

export function KanbanColumn({
  column,
  projectId,
  tasks,
  onTaskEdit,
  onAddTask,
  onTaskCreate,
  onColumnRename,
  overId,
  activeTaskId,
  onDependencyClick,
  dragHandleProps,
}: KanbanColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(column.name)
  const config = getColumnColor(column.color)
  const Icon = (column.icon && ICON_MAP[column.icon]) || Columns3
  const { glowIntensity: globalGlow } = useThemeStore()
  const mult = globalGlow / 75

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  })

  const taskIds = tasks.map((t) => t.id)

  const dynamicGlow = globalGlow > 0
    ? { boxShadow: config.glow.replace(/0_0_(\d+)px/g, (_, num) => `0_0_${Math.round(parseInt(num) * mult)}px`) }
    : {}

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== column.name) {
      onColumnRename?.(column.id, trimmed)
    }
    setIsRenaming(false)
  }

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
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {dragHandleProps && (
              <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-slate-500 hover:text-slate-300">
                <GripVertical className="w-4 h-4" />
              </div>
            )}

            {isRenaming ? (
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="flex-1 px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  autoFocus
                />
                <button onClick={handleRenameSubmit} className="p-1 rounded hover:bg-white/10 text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsRenaming(false)} className="p-1 rounded hover:bg-white/10 text-slate-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
                  'border backdrop-blur-md cursor-pointer',
                  config.bg, config.border, config.text,
                  globalGlow > 0 && config.glow
                )}
                style={dynamicGlow}
                onDoubleClick={() => {
                  setRenameValue(column.name)
                  setIsRenaming(true)
                }}
              >
                <Icon className="w-4 h-4" />
                <span>{column.name}</span>
                <span className="font-bold">{tasks.length}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {!isRenaming && (
              <button
                onClick={() => {
                  setRenameValue(column.name)
                  setIsRenaming(true)
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Pencil className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
            <button
              onClick={onAddTask}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <Plus className="w-4 h-4 text-slate-400" />
            </button>
          </div>
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
                onDependencyClick={onDependencyClick}
                columnGlowColor={config.glowColor}
                showDropIndicator={overId === task.id && activeTaskId !== task.id}
              />
            ))}
          </AnimatePresence>
        </SortableContext>

        <div className="mt-2">
          <QuickAddTask
            projectId={projectId}
            columnId={column.id}
            onTaskCreate={onTaskCreate}
          />
        </div>
      </div>
    </div>
  )
}
