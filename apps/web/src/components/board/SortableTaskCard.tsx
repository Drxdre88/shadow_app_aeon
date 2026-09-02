'use client'

import { useState, useRef, useMemo, memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { Calendar, MoreHorizontal, Check, X, Clock, Trash2, Bot, Zap } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { hexToRgba, resolveAccentHex } from '@/lib/utils/colors'
import { getInitials, getInitialsFromEmail } from '@/lib/utils/initials'
import { resolvePriority } from '@/lib/utils/priorities'
import { labelHex, readableTextColor } from './labelTile'
import { progressBarStyle } from './progressColor'
import { GlowCard } from '@/components/ui/GlowCard'
import { useBoardStore, useSelectedTaskId, useLabels, useShowDates, useChecklistViewMode, useTaskAssignees } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { DependencyIndicator } from './DependencyIndicator'
import { TaskContextMenu } from './TaskContextMenu'
import { TaskSizeBadge } from './TaskSizeBadge'
import { StaleIndicator } from './StaleIndicator'
import { CardPeekPreview } from './CardPeekPreview'
import { getTriState, cycleTaskCompletion, type TriState } from './triState'
import { readHangarMission } from './autoRun'

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
    progress?: number | null
    updatedAt?: string
    metadata?: Record<string, unknown>
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
  animateOnMount?: boolean
}

const priorityGlows = {
  low: 'none' as const,
  medium: 'sm' as const,
  high: 'md' as const,
  urgent: 'lg' as const,
}

export const SortableTaskCard = memo(function SortableTaskCard({ task, onEdit, onDependencyClick, columnGlowColor, showDropIndicator = false, onTaskUpdate, onTaskDelete, onPushToGantt, onSendToVault, onArchiveTask, animateOnMount = true }: SortableTaskCardProps) {
  const selectedTaskId = useSelectedTaskId()
  const selectTask = useBoardStore((s) => s.selectTask)
  const labels = useLabels()
  const clSummary = useBoardStore((s) => s.checklistSummaries[task.id])
  const clPreview = useBoardStore((s) => s.checklistPreviews[task.id])
  const assignees = useTaskAssignees(task.id)
  const showDates = useShowDates()
  const checklistMode = useChecklistViewMode()
  const updateTask = useBoardStore((s) => s.updateTask)
  const crossedTaskIds = useBoardStore((s) => s.crossedTaskIds)
  const { glowIntensity: globalGlow, glowSource, priorities, smoothUiRenders } = useThemeStore()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(task.name)
  // Auto AI cards wear their mission on the board face.
  const mission = useMemo(() => {
    const hangar = readHangarMission(task.metadata)
    if (!hangar) return null
    return {
      repo: typeof hangar.repo === 'string' ? hangar.repo : '',
      objective: typeof hangar.objective === 'string' ? hangar.objective : 'mission',
      armed: hangar.autoRun === true,
    }
  }, [task.metadata])
  const editRef = useRef<HTMLInputElement>(null)
  const cardElRef = useRef<HTMLDivElement>(null)
  const isSelected = selectedTaskId === task.id
  const mult = globalGlow / 75

  const resolvedGlowColor = (() => {
    if (glowSource === 'manual') return task.color
    if (glowSource === 'priority') {
      const p = priorities.find((pr) => pr.id === task.priority)
      return p?.color ?? task.color
    }
    if (glowSource === 'first-label') {
      const firstLabelId = task.labels?.[0]
      if (firstLabelId) {
        const label = labels.find((l) => l.id === firstLabelId)
        if (label?.color) return label.color
      }
      return task.color
    }
    if (glowSource === 'column') return columnGlowColor
    return task.color
  })()
  const triState: TriState = getTriState(task.status, crossedTaskIds, task.id)

  const handleTriToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    cycleTaskCompletion(task.id, onTaskUpdate)
  }

  const getPriorityInfo = (priority: string) => {
    const resolved = resolvePriority(priorities, priority)
    return { label: resolved.name, style: { backgroundColor: `${resolved.color}33`, color: resolved.color } }
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
    // Instant mode: open on first click, skip the double-click disambiguation wait.
    if (!smoothUiRenders) { onEdit?.(task.id); return }
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
        // touch-action: manipulation (NOT none): a finger landing on a card
        // must still be able to scroll the column / pan the board. The delayed
        // TouchSensor takes over only after a 250ms hold; 'manipulation' just
        // strips double-tap zoom so taps stay snappy. user-select/touch-callout
        // are off so the long-press shows a drag, not iOS text selection.
        style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        className={cn(
          'cursor-grab active:cursor-grabbing',
          isDragging && 'opacity-30 scale-95'
        )}
        initial={animateOnMount ? { opacity: 0, y: 10 } : false}
        animate={{ opacity: isDragging ? 0.3 : 1, y: 0, scale: isDragging ? 0.95 : 1 }}
        whileTap={{ scale: 0.97 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
      >
        <GlowCard
          accentColor={resolvedGlowColor}
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
                title="Toggle done / not-doing / none — or press X while hovering the card"
                aria-label="Cycle completion state"
                className={cn(
                  'flex-shrink-0 w-6 h-6 rounded-md border-2 mt-px transition-all duration-300',
                  'flex items-center justify-center',
                  triState === 'checked' && 'bg-emerald-500 border-emerald-400',
                  triState === 'crossed' && 'bg-red-500 border-red-400',
                  triState === 'unchecked' && 'border-white/25 hover:border-white/50 hover:bg-white/5'
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
                {triState === 'checked' && <Check className="w-3.5 h-3.5 text-white" />}
                {triState === 'crossed' && <X className="w-3.5 h-3.5 text-white" />}
              </button>
              {isEditing ? (
                <input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={handleInlineSubmit}
                  onKeyDown={handleInlineKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-white bg-white/10 rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-white/20"
                  style={{ border: '1px solid color-mix(in srgb, var(--primary) 50%, transparent)' }}
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
                data-task-edit
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

          {mission && (
            <div className="flex flex-wrap items-center gap-1 mb-2">
              <span
                title={`AI mission — ${mission.objective} in ${mission.repo}${mission.armed ? ' (auto-run armed)' : ''}`}
                className="inline-flex items-center gap-1 px-1.5 rounded text-[9px] font-semibold leading-[15px] border"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--primary) 45%, transparent)',
                  color: 'var(--primary)',
                }}
              >
                <Bot className="w-2.5 h-2.5" />
                {mission.repo || 'mission'}
                {mission.armed && <Zap className="w-2.5 h-2.5" />}
              </span>
              <span className="px-1.5 rounded text-[9px] font-medium leading-[15px] border border-white/10 bg-white/5 text-slate-400">
                {mission.objective}
              </span>
            </div>
          )}

          {taskLabels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {taskLabels.slice(0, 4).map((label) => {
                const hex = labelHex(label.color)
                return (
                  <span
                    key={label.id}
                    title={label.name}
                    className="max-w-[96px] truncate px-1.5 rounded text-[9px] font-semibold leading-[15px] border"
                    style={{
                      backgroundColor: hex,
                      borderColor: hexToRgba(hex, 0.55),
                      color: readableTextColor(hex),
                    }}
                  >
                    {label.name}
                  </span>
                )
              })}
              {taskLabels.length > 4 && (
                <span className="text-[9px] text-slate-500">+{taskLabels.length - 4}</span>
              )}
            </div>
          )}

          {assignees && assignees.length > 0 && (
            <div className="flex items-center -space-x-1.5 mb-1.5">
              {assignees.slice(0, 4).map((a) => (
                <AssigneeDot key={a.userId} name={a.name} email={a.email} initials={a.initials} image={a.image} kind={a.kind} color={a.color} />
              ))}
              {assignees.length > 4 && (
                <span className="w-5 h-5 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[8px] text-white/60">
                  +{assignees.length - 4}
                </span>
              )}
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
                    className="px-2 py-0.5 rounded-md text-xs font-medium"
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

      {typeof task.progress === 'number' && (() => {
        const pct = Math.min(100, Math.max(0, task.progress))
        const bar = progressBarStyle(pct)
        return (
          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 h-1 rounded-b-xl overflow-hidden bg-white/[0.06] pointer-events-none',
              isDragging && 'opacity-30'
            )}
            title={`${pct}% complete`}
          >
            <div
              className="relative h-full transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%`, background: bar.fill, boxShadow: bar.glow }}
            >
              <div
                className="absolute inset-0 mix-blend-screen"
                style={{ background: bar.cloud, filter: 'blur(1.5px)' }}
              />
            </div>
          </div>
        )
      })()}

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

function AssigneeDot({ name, email, initials: stored, image, kind, color }: { name: string | null; email?: string | null; initials?: string | null; image: string | null; kind?: 'virtual'; color?: string | null }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className="w-5 h-5 rounded-full object-cover border border-white/15" title={name ?? undefined} />
  }
  // Stored initials win — a virtual member named "MG" chose those two letters,
  // and recomputing from the name would render "M". Then the name, then the
  // email, and only then the '?' that means "we know nothing about this person".
  const initials = (stored ?? '').trim() || getInitials(name, '') || getInitialsFromEmail(email) || '?'
  // Virtual members: colored initials avatar with a dashed ring — subtly
  // distinct from real accounts in the pile.
  if (kind === 'virtual') {
    const hex = resolveAccentHex(color)
    return (
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold border border-dashed border-white/45 text-white"
        style={{ background: `linear-gradient(135deg, ${hex}cc, ${hex}66)` }}
        title={name ? `${name} (virtual)` : undefined}
      >
        {initials || '?'}
      </span>
    )
  }
  return (
    <span
      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-medium border border-white/15 text-white/80"
      style={{ background: 'rgba(255,255,255,0.08)' }}
      title={name ?? undefined}
    >
      {initials || '?'}
    </span>
  )
}
