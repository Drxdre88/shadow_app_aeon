'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Minimize2 } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { useZenModeStore } from '@/lib/store/zenModeStore'
import { useThemeStore } from '@/stores/themeStore'
import { COLUMN_ICON_MAP } from '@/lib/utils/columnIcons'
import { VirtualizedTaskList, type TaskItem } from './VirtualizedTaskList'
import { DragPreview } from './DragPreview'
import { ZenScrollbar } from './ZenScrollbar'
import { zenTargetRect, flightTransform, measureColumnRect, type FlightTransform, type ZenRect } from './zenFlight'

type MoveUpdate = { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }

interface ZenModeLayerProps {
  column: BoardColumn
  projectId: string
  tasks: TaskItem[]
  /** True while another overlay (edit modal, pickers) owns Escape. */
  escapeDisabled?: boolean
  onTaskEdit?: (taskId: string) => void
  onDependencyClick?: (taskId: string) => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
  onPushToGantt?: (taskId: string) => void
  onSendToVault?: (taskId: string) => void
  onArchiveTask?: (taskId: string) => void
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
    size?: number | null
    orderIndex: number
  }) => void
  onTaskMove?: (updates: MoveUpdate[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
}

/**
 * The Zen focus surface: the chosen column FLIP-flies from its on-board rect
 * to a centered, full-height panel above a blurred backdrop, then flies back
 * on exit. Lives in a portal above the (possibly pinch-scaled) board —
 * z-[35]: above the board, below pinned floating cards (z-40) and modals
 * (z-50), so a card opened from Zen still stacks on top.
 */
export function ZenModeLayer({
  column,
  projectId,
  tasks,
  escapeDisabled,
  onTaskEdit,
  onDependencyClick,
  onTaskUpdate,
  onTaskDelete,
  onPushToGantt,
  onSendToVault,
  onArchiveTask,
  onTaskCreate,
  onTaskMove,
}: ZenModeLayerProps) {
  const sourceRect = useZenModeStore((s) => s.sourceRect)
  const clearZen = useZenModeStore((s) => s.clear)
  const { colors, glowIntensity, smoothUiRenders, dragEffect } = useThemeStore(
    useShallow((s) => ({ colors: s.colors, glowIntensity: s.glowIntensity, smoothUiRenders: s.smoothUiRenders, dragEffect: s.dragEffect }))
  )
  const reduceMotion = !smoothUiRenders
  const mult = glowIntensity / 75

  const [target, setTarget] = useState<ZenRect | null>(() =>
    typeof window === 'undefined' ? null : zenTargetRect(window.innerWidth, window.innerHeight)
  )
  const [phase, setPhase] = useState<'open' | 'closing'>('open')
  const [exitPose, setExitPose] = useState<FlightTransform | null>(null)
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null)
  const [entering, setEntering] = useState(true)
  const closingRef = useRef(false)
  const exitFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollElRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => {
    if (exitFallbackRef.current) clearTimeout(exitFallbackRef.current)
  }, [])

  // The card-settle stagger (globals.css) lives only through the entry beat:
  // DOM reorders restart CSS animations, so the rule can't stay armed.
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 900)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onResize = () => setTarget(zenTargetRect(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const beginExit = useCallback(() => {
    if (closingRef.current) return
    const backRect = measureColumnRect(column.id) ?? useZenModeStore.getState().sourceRect
    if (reduceMotion || !target || !backRect) {
      clearZen()
      return
    }
    closingRef.current = true
    setExitPose(flightTransform(backRect, target))
    setPhase('closing')
    // Teardown must not depend solely on onAnimationComplete: a pose that is
    // already at its target can settle without firing it, which would strand
    // the app behind the blur.
    exitFallbackRef.current = setTimeout(clearZen, 700)
  }, [column.id, reduceMotion, target, clearZen])

  // Escape during an in-Zen card drag belongs to dnd-kit (cancels the drag);
  // only a free Escape exits Zen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !escapeDisabled && !activeTask) beginExit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [escapeDisabled, activeTask, beginExit])

  const entryPose = useMemo<FlightTransform | null>(
    () => (target && sourceRect ? flightTransform(sourceRect, target) : null),
    [target, sourceRect]
  )

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks])

  // Same activation tuning as the board: hold 250ms on touch to lift a card,
  // flick within the delay to scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = useBoardStore.getState().tasks.find((t) => t.id === event.active.id)
    if (task) setActiveTask(task)
  }, [])

  // Within-column reorder only: the other columns aren't visible in Zen, so
  // the drop target is always a sibling card. The move is computed against
  // the column's FULL order (filters may hide cards), mirroring the board.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const columnTasks = useBoardStore
      .getState()
      .tasks.filter((t) => t.columnId === column.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)
    const orderedIds = columnTasks.map((t) => t.id)
    const from = orderedIds.indexOf(active.id as string)
    const to = orderedIds.indexOf(over.id as string)
    if (from === -1 || to === -1 || from === to) return

    const snapshot = columnTasks.map((t) => ({ id: t.id, columnId: t.columnId, orderIndex: t.orderIndex }))
    const byId = new Map(columnTasks.map((t) => [t.id, t]))
    const finalIds = arrayMove(orderedIds, from, to)

    const updates: MoveUpdate[] = []
    finalIds.forEach((id, orderIndex) => {
      if (id === active.id) {
        updates.push({ id, orderIndex, columnId: column.id, name: byId.get(id)?.name })
        return
      }
      const sibling = byId.get(id)
      if (!sibling || sibling.orderIndex === orderIndex) return
      updates.push({ id, orderIndex })
    })

    const { updateTask } = useBoardStore.getState()
    for (const update of updates) updateTask(update.id, { orderIndex: update.orderIndex })
    onTaskMove?.(updates, snapshot)
  }, [column.id, onTaskMove])

  if (!target || typeof document === 'undefined') return null

  const SelectedIcon = column.icon ? COLUMN_ICON_MAP[column.icon] : null
  const glow02 = colors.glowColor.replace(/[\d.]+\)$/, '0.2)')
  const glow025 = colors.glowColor.replace(/[\d.]+\)$/, '0.25)')

  return createPortal(
    <div className="fixed inset-0 z-[35]" data-zen-layer>
      <motion.div
        data-zen-backdrop
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: phase === 'closing' ? 0 : 1 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={beginExit}
      />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveTask(null)}>
        <motion.div
          data-zen-surface
          role="dialog"
          aria-modal="true"
          aria-label={`${column.name} — Zen mode`}
          initial={reduceMotion || !entryPose ? false : { ...entryPose, opacity: 0.85 }}
          animate={
            phase === 'closing' && exitPose
              ? { ...exitPose, opacity: 0.85 }
              : { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }
          }
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 32, mass: 0.9 }}
          onAnimationComplete={() => {
            if (closingRef.current) clearZen()
          }}
          className="absolute flex flex-col rounded-2xl overflow-hidden backdrop-blur-2xl border"
          style={{
            left: target.left,
            top: target.top,
            width: target.width,
            height: target.height,
            transformOrigin: '0 0',
            background: 'linear-gradient(to bottom, rgba(20, 20, 32, 0.96), rgba(12, 12, 20, 0.98))',
            borderColor: glow02,
            // Static layered glow: the surface (shadow included) is scaled by
            // the flight transform, so the elevation visually grows in-flight.
            boxShadow: [
              `0 0 ${48 * mult}px ${12 * mult}px ${glow025}`,
              `0 0 ${90 * mult}px ${24 * mult}px ${colors.glowColor.replace(/[\d.]+\)$/, '0.08)')}`,
              '0 25px 60px -12px rgba(0, 0, 0, 0.8)',
              'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
            ].join(', '),
          }}
        >
          <div
            className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0"
            style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border border-white/15 bg-white/10 text-white backdrop-blur-md min-w-0">
              {SelectedIcon && <SelectedIcon className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{column.name}</span>
              <span className="text-[11px] opacity-60 font-normal">{tasks.length}</span>
            </span>
            <button
              onClick={beginExit}
              title="Exit Zen mode"
              aria-label="Exit Zen mode"
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white flex-shrink-0"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </div>

          <div
            // pr-7 reserves the scroller's 28px hit strip: without it the strip
            // overlays the cards' right edge and swallows taps meant for them.
            className="relative flex-1 min-h-0 flex flex-col pr-7"
            data-zen-cards
            data-zen-enter={entering ? '' : undefined}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <VirtualizedTaskList
              tasks={tasks}
              taskIds={taskIds}
              columnId={column.id}
              projectId={projectId}
              glowColor={colors.glowColor}
              overId={null}
              activeTaskId={activeTask?.id ?? null}
              scrollRef={scrollElRef}
              onTaskEdit={onTaskEdit}
              onDependencyClick={onDependencyClick}
              onTaskUpdate={onTaskUpdate}
              onTaskDelete={onTaskDelete}
              onPushToGantt={onPushToGantt}
              onSendToVault={onSendToVault}
              onArchiveTask={onArchiveTask}
              onTaskCreate={onTaskCreate}
            />
            <ZenScrollbar
              scrollRef={scrollElRef}
              accentColor={colors.primary}
              glowColor={colors.glowColor}
              reduceMotion={reduceMotion}
              contentKey={tasks.length}
            />
          </div>
        </motion.div>

        {/* Outside the transformed surface: fixed-position overlays inside a
            transformed ancestor anchor to it instead of the viewport. */}
        <DragOverlay dropAnimation={reduceMotion ? { duration: 0 } : { duration: 300, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeTask && <DragPreview task={activeTask} effect={dragEffect} globalGlow={glowIntensity} />}
        </DragOverlay>
      </DndContext>
    </div>,
    document.body
  )
}
