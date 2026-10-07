'use client'

import { useState, useRef, memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'framer-motion'
import { MoreHorizontal, MoreVertical, Check, X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { hexToRgba } from '@/lib/utils/colors'
import { useAvatarPrefs } from './sizing'
import { labelHex, readableTextColor } from './labelTile'
import { GlowCard } from '@/components/ui/GlowCard'
import { useBoardStore, useSelectedTaskId, useIsTaskSelected, useLabels, useShowDates, useChecklistViewMode, useTaskAssignees } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { useCardHoldGesture, useHoldToMoveActions, halfFromPoint } from './useHoldToMove'
import { nextSelection, selectModifiersFromEvent } from './cardSelection'
import { TaskContextMenu } from './TaskContextMenu'
import { ExtractCardContentsModal } from './ExtractCardContentsModal'
import { CardPeekPreview } from './CardPeekPreview'
import { getTriState, cycleTaskCompletion, type TriState } from './triState'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import { MissionCardFace } from './MissionCardFace'
import { TaskCardBadges, TaskCardDateRange } from './TaskCardBadges'
import { TaskCardChecklistPreview } from './TaskCardChecklistPreview'
import { TaskCardAssignees } from './TaskCardAssignees'
import { MovingRing, TaskCardProgressBar } from './TaskCardDecor'
import type { TaskCardTask } from './taskCardTypes'

interface SortableTaskCardProps {
  task: TaskCardTask
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

// Every card's pending single-click open (the 250ms double-click wait), so a
// modified click on ANY card cancels them all: plain-click A then Ctrl-click
// B within the wait must not open A mid-selection.
const pendingOpens = new Set<ReturnType<typeof setTimeout>>()
function cancelPendingOpens() {
  for (const timer of pendingOpens) clearTimeout(timer)
  pendingOpens.clear()
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
  // Multi-select (Ctrl/Cmd-click, Shift-click, the menu's Select): only this
  // card's own membership is subscribed to, so a selection change re-renders
  // the cards that changed, not the board.
  const isMultiSelected = useIsTaskSelected(task.id)
  const setTaskSelected = useBoardStore((s) => s.setTaskSelected)
  const labels = useLabels()
  const clPreview = useBoardStore((s) => s.checklistPreviews[task.id])
  const assignees = useTaskAssignees(task.id)
  const avatarPrefs = useAvatarPrefs()
  const showDates = useShowDates()
  const checklistMode = useChecklistViewMode()
  const updateTask = useBoardStore((s) => s.updateTask)
  const crossedTaskIds = useBoardStore((s) => s.crossedTaskIds)
  const { glowIntensity: globalGlow, glowSource, priorities, smoothUiRenders } = useThemeStore()
  // Hold-to-move: only the lifted card subscribes to the id, so arming or
  // cancelling a hold re-renders one card, not the board. Neutral cards get
  // their "drop here" cursor from CSS via the columns wrapper's
  // data-moving-mode, and a click reads the id from the store at click time.
  const isMoving = useBoardStore((s) => s.movingTaskId === task.id)
  const holdToMove = useHoldToMoveActions()
  // Firefox delivers contextmenu as a MouseEvent with no pointerType, so the
  // last pointerdown's type is what tells a touch long-press from a right click.
  const lastPointerTypeRef = useRef<string | undefined>(undefined)
  const { holdHandlers, consumeHoldClick } = useCardHoldGesture(task.id)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [extractOpen, setExtractOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(task.name)
  const editRef = useRef<HTMLInputElement>(null)
  const cardElRef = useRef<HTMLDivElement>(null)
  // A finger never hovers and never fires contextmenu, so the card's menu needs
  // a permanent button of its own on touch-first devices.
  const coarsePointer = useCoarsePointer()
  const isSelected = selectedTaskId === task.id || isMultiSelected
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
    // The release of a completed hold is not an open.
    if (consumeHoldClick()) return
    // Ctrl/Cmd-click toggles this card in the selection, Shift-click selects
    // the run from the last-selected card in this column. Neither opens the
    // card — the selection feeds the menu's "Fuse N cards into this one".
    const mods = selectModifiersFromEvent(e)
    if (mods) {
      cancelPendingOpens()
      clickTimerRef.current = null
      const { tasks, selectedTaskIds, setSelectedTaskIds } = useBoardStore.getState()
      const columnId = tasks.find((t) => t.id === task.id)?.columnId
      const columnOrder = tasks
        .filter((t) => t.columnId === columnId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((t) => t.id)
      setSelectedTaskIds(nextSelection(selectedTaskIds, task.id, mods, columnOrder))
      return
    }
    // Move mode: this tap PLACES (or cancels on the lifted card itself) and
    // never opens. Hover, shortcuts and the rest of the card stay live.
    const movingTaskId = useBoardStore.getState().movingTaskId
    if (movingTaskId && holdToMove) {
      if (isMoving) { holdToMove.cancel(); return }
      const columnId = useBoardStore.getState().tasks.find((t) => t.id === task.id)?.columnId
      const rect = cardElRef.current?.getBoundingClientRect()
      if (columnId && rect) {
        holdToMove.place({ columnId, kind: 'card', taskId: task.id, half: halfFromPoint(e.clientY, rect) })
      }
      return
    }
    // Instant mode: open on first click, skip the double-click disambiguation wait.
    if (!smoothUiRenders) { onEdit?.(task.id); return }
    // A pending timer that a modified click elsewhere already cancelled is
    // not a first click to pair with — only a live one counts as the first
    // half of a double-click.
    const pending = clickTimerRef.current
    if (pending !== null && pendingOpens.has(pending)) {
      clearTimeout(pending)
      pendingOpens.delete(pending)
      clickTimerRef.current = null
      return
    }
    const timer = setTimeout(() => { pendingOpens.delete(timer); clickTimerRef.current = null; onEdit?.(task.id) }, 250)
    pendingOpens.add(timer)
    clickTimerRef.current = timer
  }

  const cancelOwnPendingOpen = () => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); pendingOpens.delete(clickTimerRef.current); clickTimerRef.current = null }
  }

  const handleInlineEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    cancelOwnPendingOpen()
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
    // A touch long-press means "lift the card" (TouchSensor / hold-to-move),
    // never the context menu: Android fires contextmenu for it, iOS doesn't.
    const pointerType = (e.nativeEvent as Partial<PointerEvent>).pointerType ?? lastPointerTypeRef.current
    if (pointerType === 'touch') return
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  // The touch route into the same menu: anchored under the button instead of
  // at a pointer that has no coordinates worth reusing.
  const handleMenuButton = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    cancelOwnPendingOpen()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }))
  }

  // dnd-kit's sensors and the hold gesture both live on the card surface above
  // this button: without this the first touch on it lifts the card.
  const swallowGesture = (e: React.SyntheticEvent) => { e.stopPropagation() }

  return (
    <div ref={(el) => { setNodeRef(el); (cardElRef as React.MutableRefObject<HTMLDivElement | null>).current = el }} style={style} className="relative" data-task-id={task.id} data-moving={isMoving ? '' : undefined}>
      <CardPeekPreview taskId={task.id} triggerRef={cardElRef} />
      {isMoving && <MovingRing color={resolvedGlowColor} pulse={smoothUiRenders} />}
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
        {...holdHandlers}
        data-card-surface
        onPointerDownCapture={(e) => { lastPointerTypeRef.current = e.pointerType }}
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
            {assignees && assignees.length > 0 && (
              <TaskCardAssignees assignees={assignees} preferInitials={avatarPrefs.preferInitials} />
            )}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <div className={cn('flex items-center gap-0.5', coarsePointer ? 'hidden' : 'opacity-0 group-hover:opacity-100')}>
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
              <button
                data-task-menu
                aria-label="Card menu"
                title="Card menu"
                onClick={handleMenuButton}
                onPointerDown={swallowGesture}
                onTouchStart={swallowGesture}
                onMouseDown={swallowGesture}
                onDoubleClick={swallowGesture}
                style={{ touchAction: 'manipulation' }}
                className={cn(
                  'p-1 rounded-md hover:bg-white/10 transition-colors',
                  coarsePointer ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <MoreVertical className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          </div>

          <MissionCardFace metadata={task.metadata} />

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

          {checklistMode !== 'off' && clPreview && clPreview.length > 0 && (
            <TaskCardChecklistPreview items={clPreview} mode={checklistMode} />
          )}

          <TaskCardBadges task={task} onDependencyClick={onDependencyClick} />

          {showDates && task.startDate && task.endDate && (
            <TaskCardDateRange startDate={task.startDate} endDate={task.endDate} />
          )}

        </GlowCard>
      </motion.div>

      {typeof task.progress === 'number' && <TaskCardProgressBar progress={task.progress} dimmed={isDragging} />}

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
          // The menu's Select is the touch route into multi-select: it adds
          // this card to the selection (and makes it the keyboard's card);
          // Deselect removes it from both — but never drops a keyboard
          // selection that points at another card.
          onSelectTask={(id) => {
            if (id !== null) selectTask(id)
            else if (selectedTaskId === task.id) selectTask(null)
            setTaskSelected(task.id, id !== null)
          }}
          onExtractContents={() => setExtractOpen(true)}
          isSelected={isSelected}
        />
      )}
      {extractOpen && <ExtractCardContentsModal taskId={task.id} onClose={() => {
        setExtractOpen(false)
        requestAnimationFrame(() => cardElRef.current?.querySelector<HTMLButtonElement>('[data-task-menu]')?.focus())
      }} />}
    </div>
  )
})
