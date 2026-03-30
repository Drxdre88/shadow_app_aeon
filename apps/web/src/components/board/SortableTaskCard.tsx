'use client'

import { useState, useRef, memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { Calendar, Tag, MoreHorizontal, Check, X, Clock, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { GlowCard } from '@/components/ui/GlowCard'
import { useBoardStore, useSelectedTaskId, useLabels, useShowDates, useChecklistViewMode } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { DependencyIndicator } from './DependencyIndicator'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskSizeBadge } from './TaskSizeBadge'
import { StaleIndicator } from './StaleIndicator'
import { CardPeekPreview } from './CardPeekPreview'
import { triggerCelebration } from '@/components/celebrations'

interface SortableTaskCardProps {
  task: {
    id: string
    name: string
    description?: string
    status: string
    color: string
    priority: 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    startDate?: string
    endDate?: string
    onTimeline: boolean
    size?: number | null
    updatedAt?: string
  }
  onEdit?: (taskId: string) => void
  onDependencyClick?: (taskId: string) => void
  columnGlowColor: string
  showDropIndicator?: boolean
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
  onPushToGantt?: (taskId: string) => void
  onSendToVault?: (taskId: string) => void
  onArchiveTask?: (taskId: string) => void
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

type TriState = 'unchecked' | 'checked' | 'crossed'

export const crossedTaskIds = new Set<string>()

export function clearCrossedState() {
  crossedTaskIds.clear()
}

function nextTriState(s: TriState): TriState {
  if (s === 'unchecked') return 'checked'
  if (s === 'checked') return 'crossed'
  return 'unchecked'
}

function statusToTri(taskId: string, status: string): TriState {
  if (status === 'done') return 'checked'
  if (crossedTaskIds.has(taskId)) return 'crossed'
  return 'unchecked'
}

function triToStatus(tri: TriState, fallback: string): string {
  if (tri === 'checked') return 'done'
  if (tri === 'crossed') return 'todo'
  return fallback === 'done' ? 'todo' : fallback
}

export const SortableTaskCard = memo(function SortableTaskCard({ task, onEdit, onDependencyClick, columnGlowColor, showDropIndicator = false, onTaskUpdate, onTaskDelete, onPushToGantt, onSendToVault, onArchiveTask }: SortableTaskCardProps) {
  const selectedTaskId = useSelectedTaskId()
  const selectTask = useBoardStore((s) => s.selectTask)
  const labels = useLabels()
  const clSummary = useBoardStore((s) => s.checklistSummaries[task.id])
  const clPreview = useBoardStore((s) => s.checklistPreviews[task.id])
  const showDates = useShowDates()
  const checklistMode = useChecklistViewMode()
  const updateTask = useBoardStore((s) => s.updateTask)
  const { glowIntensity: globalGlow, priorities } = useThemeStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(task.name)
  const editRef = useRef<HTMLInputElement>(null)
  const cardElRef = useRef<HTMLDivElement>(null)
  const isSelected = selectedTaskId === task.id
  const mult = globalGlow / 75
  const triState = statusToTri(task.id, task.status)

  const handleTriToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = nextTriState(triState)
    if (next === 'crossed') {
      crossedTaskIds.add(task.id)
    } else {
      crossedTaskIds.delete(task.id)
    }
    const newStatus = triToStatus(next, task.status)
    updateTask(task.id, { status: newStatus })
    onTaskUpdate?.(task.id, { status: newStatus })
    if (newStatus === 'done') {
      const rect = (e.target as HTMLElement).closest('[data-task-id]')?.getBoundingClientRect()
      if (rect) triggerCelebration(rect.left + rect.width / 2, rect.top + rect.height / 2)
    }
  }

  const getPriorityInfo = (priority: string) => {
    const custom = priorities.find((p) => p.id === priority)
    if (custom) return { label: custom.name, style: { backgroundColor: `${custom.color}33`, color: custom.color } }
    const defaultMatch = priorityColors[priority as keyof typeof priorityColors]
    if (defaultMatch) return { label: priority, className: defaultMatch }
    return { label: priority, className: priorityColors.medium }
  }

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

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCardClick = (e: React.MouseEvent) => {
    if (isEditing) return
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; return }
    clickTimerRef.current = setTimeout(() => { clickTimerRef.current = null; onEdit?.(task.id) }, 250)
  }

  const handleInlineEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    setEditName(task.name)
    setIsEditing(true)
    setTimeout(() => editRef.current?.select(), 0)
  }

  const handleInlineSubmit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== task.name) {
      updateTask(task.id, { name: trimmed })
      onTaskUpdate?.(task.id, { name: trimmed })
    }
    setIsEditing(false)
  }

  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') handleInlineSubmit()
    if (e.key === 'Escape') { setIsEditing(false); setEditName(task.name) }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div ref={(el) => { setNodeRef(el); (cardElRef as React.MutableRefObject<HTMLDivElement | null>).current = el }} style={style} className="relative" data-task-id={task.id}>
      <CardPeekPreview taskId={task.id} triggerRef={cardElRef} />
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
        onClick={handleCardClick}
        onContextMenu={handleContextMenu}
        style={{ touchAction: 'none' }}
        className={cn(
          'cursor-grab active:cursor-grabbing',
          isDragging && 'opacity-30 scale-95'
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: isDragging ? 0.3 : 1, y: 0, scale: isDragging ? 0.95 : 1 }}
        whileTap={{ scale: 0.97 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
      >
        <GlowCard
          accentColor={task.color}
          glowIntensity={priorityGlows[task.priority]}
          showAccentLine
          selected={isSelected}
          hover
          className="p-3 group min-h-[100px]"
        >
          <div className="flex items-start justify-between mb-1">
            <div className="flex items-start gap-2 flex-1 mr-2 min-w-0">
              <button
                onClick={handleTriToggle}
                className={cn(
                  'flex-shrink-0 w-[18px] h-[18px] rounded border-2 mt-0.5 transition-all duration-300',
                  'flex items-center justify-center',
                  triState === 'checked' && 'bg-emerald-500 border-emerald-400',
                  triState === 'crossed' && 'bg-red-500 border-red-400',
                  triState === 'unchecked' && 'border-white/25 hover:border-white/50'
                )}
                style={{
                  boxShadow:
                    triState === 'checked'
                      ? '0 0 8px rgba(16,185,129,0.5)'
                      : triState === 'crossed'
                        ? '0 0 8px rgba(239,68,68,0.5)'
                        : undefined,
                }}
              >
                {triState === 'checked' && <Check className="w-2.5 h-2.5 text-white" />}
                {triState === 'crossed' && <X className="w-2.5 h-2.5 text-white" />}
              </button>
              {isEditing ? (
                <input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleInlineSubmit}
                  onKeyDown={handleInlineKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-white bg-white/10 border border-purple-500/50 rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                  autoFocus
                />
              ) : (
                <h4
                  onDoubleClick={handleInlineEdit}
                  className={cn(
                    'text-sm font-medium line-clamp-2',
                    triState === 'checked' && 'line-through text-slate-500',
                    triState === 'crossed' && 'line-through text-red-400/50',
                    triState === 'unchecked' && 'text-white',
                  )}
                >
                  {task.name}
                </h4>
              )}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onEdit?.(task.id) }}
                className="p-1 rounded-md hover:bg-white/10 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4 text-slate-400" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTaskDelete?.(task.id)
                }}
                className="p-1 rounded-md hover:bg-red-500/15 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
              </button>
            </div>
          </div>

          {taskLabels.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {taskLabels.map((label) => {
                const labelColors = colorConfig[label.color as AccentColor]
                const isCustom = !labelColors
                const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
                return (
                  <span
                    key={label.id}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[10px] font-medium flex items-center gap-1',
                      'backdrop-blur-md border',
                      !isCustom && labelColors?.bg,
                      !isCustom && labelColors?.border,
                      !isCustom && labelColors?.text,
                      isCustom && 'text-white'
                    )}
                    style={isCustom ? {
                      backgroundColor: hexToRgba(hex, 0.15),
                      borderColor: hexToRgba(hex, 0.3),
                      color: hex,
                    } : undefined}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {label.name}
                  </span>
                )
              })}
            </div>
          )}

          {checklistMode !== 'off' && clPreview && clPreview.length > 0 && (() => {
            if (checklistMode === 'preview') {
              return (
                <div className="space-y-0.5 mb-1.5">
                  {clPreview.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div className={cn(
                        'w-2.5 h-2.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
                        item.state === 'checked' && 'bg-emerald-500/30 border-emerald-500/50',
                        item.state === 'crossed' && 'bg-red-500/30 border-red-500/50',
                        item.state === 'unchecked' && 'border-white/20',
                      )}>
                        {item.state === 'checked' && <Check className="w-1.5 h-1.5 text-emerald-400" />}
                        {item.state === 'crossed' && <X className="w-1.5 h-1.5 text-red-400" />}
                      </div>
                      <span className={cn(
                        'text-[10px] truncate leading-tight',
                        item.state === 'checked' && 'text-slate-600 line-through',
                        item.state === 'crossed' && 'text-red-400/40 line-through',
                        item.state === 'unchecked' && 'text-slate-400',
                      )}>
                        {item.title}
                      </span>
                    </div>
                  ))}
                  {clPreview.length > 5 && (
                    <span className="text-[9px] text-slate-600 pl-4">+{clPreview.length - 5} more</span>
                  )}
                </div>
              )
            }
            const groups = new Map<string, typeof clPreview>()
            for (const item of clPreview) {
              const g = item.groupName || 'Checklist'
              if (!groups.has(g)) groups.set(g, [])
              groups.get(g)!.push(item)
            }
            return (
              <div className="space-y-1.5 mb-1.5">
                {[...groups.entries()].map(([groupName, items]) => (
                  <div key={groupName}>
                    <span className="text-[9px] uppercase tracking-wider text-slate-600 font-medium">{groupName}</span>
                    <div className="space-y-0.5 mt-0.5">
                      {items.map((item, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className={cn(
                            'w-2.5 h-2.5 rounded-sm border flex-shrink-0 flex items-center justify-center',
                            item.state === 'checked' && 'bg-emerald-500/30 border-emerald-500/50',
                            item.state === 'crossed' && 'bg-red-500/30 border-red-500/50',
                            item.state === 'unchecked' && 'border-white/20',
                          )}>
                            {item.state === 'checked' && <Check className="w-1.5 h-1.5 text-emerald-400" />}
                            {item.state === 'crossed' && <X className="w-1.5 h-1.5 text-red-400" />}
                          </div>
                          <span className={cn(
                            'text-[10px] truncate leading-tight',
                            item.state === 'checked' && 'text-slate-600 line-through',
                            item.state === 'crossed' && 'text-red-400/40 line-through',
                            item.state === 'unchecked' && 'text-slate-400',
                          )}>
                            {item.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

          <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
            <div className="flex items-center gap-1.5">
              {(() => {
                const pi = getPriorityInfo(task.priority)
                return (
                  <span
                    className={cn('px-2 py-0.5 rounded-md text-xs font-medium', pi.className)}
                    style={pi.style}
                  >
                    {pi.label}
                  </span>
                )
              })()}
              <DependencyIndicator
                taskId={task.id}
                onClick={() => onDependencyClick?.(task.id)}
              />
            </div>

            <div className="flex items-center gap-2 ml-auto">
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

          {showDates && task.startDate && task.endDate && (() => {
            const s = new Date(task.startDate)
            const e = new Date(task.endDate)
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
          })()}
        </GlowCard>
      </motion.div>

      {contextMenu && (
        <TaskContextMenu
          taskId={task.id}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onTaskUpdate={onTaskUpdate}
          onTaskDelete={onTaskDelete}
          onPushToGantt={onPushToGantt}
          onSendToVault={onSendToVault}
          onArchiveTask={onArchiveTask}
          onSelectTask={(id) => selectTask(id)}
          isSelected={isSelected}
        />
      )}
    </div>
  )
})
