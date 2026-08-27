'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useDragControls, useMotionValue } from 'framer-motion'
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Minimize2, Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useShallow } from 'zustand/shallow'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { useZenModeStore } from '@/lib/store/zenModeStore'
import { useThemeStore } from '@/stores/themeStore'
import { COLUMN_ICON_MAP } from '@/lib/utils/columnIcons'
import { VirtualizedTaskList, type TaskItem } from './VirtualizedTaskList'
import { DragPreview } from './DragPreview'
import { ZenScrollbar } from './ZenScrollbar'
import { useBoardSensors } from './useBoardSensors'
import { buildMoveUpdates, reorderWithInsertion, type MoveUpdate } from './dropIndex'
import { zenTargetRect, flightTransform, measureColumnRect, ZEN_GUTTER, type FlightTransform, type ZenRect } from './zenFlight'

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
 * on exit. Lives in a portal above the (possibly pinch-scaled) board.
 *
 * z-[45]: the panel spans the full viewport height, so anything in the z-40
 * band — the app's sticky header, pinned floating cards — would otherwise
 * cover its top strip and swallow clicks on the drag handle and exit button.
 * Modals (z-50) still stack above, so a card opened from Zen lands on top.
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
  const { colors, glowIntensity, smoothUiRenders, dragEffect, columnWidth, zenEnterSeconds, zenExitSeconds } = useThemeStore(
    useShallow((s) => ({
      colors: s.colors,
      glowIntensity: s.glowIntensity,
      smoothUiRenders: s.smoothUiRenders,
      dragEffect: s.dragEffect,
      columnWidth: s.columnWidth,
      zenEnterSeconds: s.zenEnterSeconds,
      zenExitSeconds: s.zenExitSeconds,
    }))
  )
  const reduceMotion = !smoothUiRenders
  const mult = glowIntensity / 75
  const enterS = Math.max(1, Math.min(6, zenEnterSeconds || 3))
  const exitS = Math.max(1, Math.min(4, zenExitSeconds || 2))

  const [target, setTarget] = useState<ZenRect | null>(() =>
    typeof window === 'undefined' ? null : zenTargetRect(window.innerWidth, window.innerHeight, columnWidth)
  )
  // Owner spec 2708: the surface is a movable panel — drag it by the header,
  // pin it to a side, and the backdrop unblurs so the board stays live.
  const [pinned, setPinned] = useState(false)
  const dragControls = useDragControls()
  const dragX = useMotionValue(0)
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
  // DOM reorders restart CSS animations, so the rule can't stay armed. It is
  // paced to the configurable flight, so it must outlive it.
  useEffect(() => {
    const t = setTimeout(() => setEntering(false), enterS * 1000 + 600)
    return () => clearTimeout(t)
  }, [enterS])

  useEffect(() => {
    const onResize = () => setTarget(zenTargetRect(window.innerWidth, window.innerHeight, columnWidth))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [columnWidth])

  const beginExit = useCallback(() => {
    if (closingRef.current) return
    const backRect = measureColumnRect(column.id) ?? useZenModeStore.getState().sourceRect
    if (reduceMotion || !target || !backRect) {
      clearZen()
      return
    }
    closingRef.current = true
    // The panel may have been dragged off-center: the return flight starts
    // from the dragged rect, so land it on the source by compensating x.
    const draggedTarget = { ...target, left: target.left + dragX.get() }
    setExitPose(flightTransform(backRect, draggedTarget))
    setPhase('closing')
    // Teardown must not depend solely on onAnimationComplete: a pose that is
    // already at its target can settle without firing it, which would strand
    // the app behind the blur.
    exitFallbackRef.current = setTimeout(clearZen, exitS * 1000 + 400)
  }, [column.id, reduceMotion, target, clearZen, exitS, dragX])

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

  // Zen keeps its OWN DndContext (deliberate isolation from the board's
  // cross-column machinery) but shares the board's activation tuning.
  const sensors = useBoardSensors()

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
    const movedId = active.id as string
    // Same tested reorder math the board uses, so a Zen drop and a board drop
    // can never disagree about the resulting order.
    const finalIds = reorderWithInsertion(orderedIds, movedId, to)
    const updates: MoveUpdate[] = buildMoveUpdates(finalIds, columnTasks, {
      id: movedId,
      columnId: column.id,
      name: columnTasks.find((t) => t.id === movedId)?.name,
    })

    const { updateTask } = useBoardStore.getState()
    for (const update of updates) updateTask(update.id, { orderIndex: update.orderIndex })
    onTaskMove?.(updates, snapshot)
  }, [column.id, onTaskMove])

  if (!target || typeof document === 'undefined') return null

  const SelectedIcon = column.icon ? COLUMN_ICON_MAP[column.icon] : null
  const glow02 = colors.glowColor.replace(/[\d.]+\)$/, '0.2)')
  const glow025 = colors.glowColor.replace(/[\d.]+\)$/, '0.25)')

  const viewportWidth = typeof window !== 'undefined'
    ? window.innerWidth
    : target.left * 2 + target.width

  return createPortal(
    // While pinned the layer stops eating pointer events — the board behind
    // is fully live and only the panel itself opts back in.
    <div className={cn('fixed inset-0 z-[45]', pinned && 'pointer-events-none')} data-zen-layer>
      <motion.div
        data-zen-backdrop
        initial={reduceMotion ? false : { opacity: 0 }}
        // SOTA note (verified 2026-08): the blur itself is never animated —
        // Chromium glitches mid-animation of backdrop-filter. The pre-blurred
        // layer cross-fades via opacity, which is GPU-composited.
        animate={{ opacity: phase === 'closing' || pinned ? 0 : 1 }}
        transition={{
          duration: reduceMotion ? 0 : phase === 'closing' ? exitS * 0.85 : entering ? enterS * 0.85 : 0.5,
          ease: 'easeInOut',
        }}
        className="absolute inset-0 bg-black/70 backdrop-blur-2xl"
        style={{ pointerEvents: pinned || phase === 'closing' ? 'none' : 'auto' }}
        onClick={beginExit}
      />

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveTask(null)}>
        {/* Drag wrapper owns the layout rect + the header-drag x offset;
            the flight transform lives one level down so the entry/exit
            animation and a user drag never fight over the same x. */}
        <motion.div
          data-zen-drag
          drag="x"
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          dragElastic={0.12}
          dragConstraints={{
            left: -(target.left - ZEN_GUTTER),
            right: Math.max(0, viewportWidth - ZEN_GUTTER - (target.left + target.width)),
          }}
          className="absolute pointer-events-auto"
          style={{
            left: target.left,
            top: target.top,
            width: target.width,
            height: target.height,
            x: dragX,
          }}
        >
        <motion.div
          data-zen-surface
          role="dialog"
          aria-modal={!pinned}
          aria-label={`${column.name} — Zen mode`}
          initial={reduceMotion || !entryPose ? false : { ...entryPose, opacity: 0.85 }}
          animate={
            phase === 'closing' && exitPose
              ? { ...exitPose, opacity: 0.85 }
              : { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }
          }
          // Cinematic tween, not a spring: a long expo-out expansion on entry
          // (fast lift-off, slow majestic settle) and an expo-in-out shrink
          // back on exit. Durations are owner-configurable in Settings.
          transition={
            reduceMotion
              ? { duration: 0 }
              : phase === 'closing'
                ? { duration: exitS, ease: [0.85, 0, 0.3, 1] }
                : { duration: enterS, ease: [0.16, 1, 0.3, 1] }
          }
          onAnimationComplete={() => {
            if (closingRef.current) clearZen()
          }}
          className="w-full h-full flex flex-col rounded-2xl overflow-hidden backdrop-blur-2xl border"
          style={{
            transformOrigin: '0 0',
            // Themed, not a fixed slate: the surface reads from the active
            // preset the same way CardPeekPreview does, so Zen carries the
            // board's palette instead of a hardcoded dark.
            background: `linear-gradient(to bottom, ${colors.surface}, ${colors.background}fa)`,
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
            className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 flex-shrink-0 cursor-grab active:cursor-grabbing"
            // The header is the panel's drag handle; touchAction none so the
            // browser hands the gesture to framer instead of scrolling.
            style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))', touchAction: 'none' }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return
              dragControls.start(e)
            }}
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border border-white/15 bg-white/10 text-white backdrop-blur-md min-w-0">
              {SelectedIcon && <SelectedIcon className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{column.name}</span>
              <span className="text-[11px] opacity-60 font-normal">{tasks.length}</span>
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setPinned((v) => !v)}
                title={pinned ? 'Unpin — restore the blurred focus' : 'Pin — unblur the board and keep the panel here'}
                aria-label={pinned ? 'Unpin panel' : 'Pin panel'}
                aria-pressed={pinned}
                className={cn(
                  'p-2 rounded-lg hover:bg-white/10 transition-colors',
                  pinned ? 'text-[var(--primary)]' : 'text-slate-400 hover:text-white'
                )}
              >
                {pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
              </button>
              <button
                onClick={beginExit}
                title="Exit Zen mode"
                aria-label="Exit Zen mode"
                className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            // pr-7 reserves the scroller's 28px hit strip: without it the strip
            // overlays the cards' right edge and swallows taps meant for them.
            className="relative flex-1 min-h-0 flex flex-col pr-7"
            data-zen-cards
            data-zen-enter={entering ? '' : undefined}
            // The card-settle stagger starts mid-flight and is paced off the
            // configurable entry duration (globals.css reads the var).
            style={{
              paddingBottom: 'env(safe-area-inset-bottom)',
              '--zen-settle-base': `${(reduceMotion ? 0 : enterS * 0.45).toFixed(2)}s`,
            } as React.CSSProperties}
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
