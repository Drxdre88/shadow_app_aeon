'use client'

import { memo } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { SortableTaskCard } from './SortableTaskCard'
import { QuickAddTask } from './QuickAddTask'

// Threshold above which we stop running the per-card mount animation and let
// the browser skip painting offscreen cards (content-visibility). Below it the
// column is small enough that the entry animation is cheap and looks nice.
const DENSE_THRESHOLD = 15
const ESTIMATED_CARD_HEIGHT = 160

export type TaskItem = {
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
}

interface VirtualizedTaskListProps {
  tasks: TaskItem[]
  taskIds: string[]
  columnId: string
  projectId: string
  glowColor: string
  overId?: string | null
  activeTaskId?: string | null
  scrollRef?: React.Ref<HTMLDivElement>
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
}

// Renders every card in normal document flow. Offscreen cards are skipped by
// the browser via CSS `content-visibility: auto` — native virtualization with
// no JS measurement cache, no scroll-element observer, and therefore none of
// the blank-column / phantom-gap failure modes the @tanstack/react-virtual
// windowing kept producing on dense columns. Scales cleanly past 100 cards.
export const VirtualizedTaskList = memo(function VirtualizedTaskList({
  tasks,
  taskIds,
  columnId,
  projectId,
  glowColor,
  overId,
  activeTaskId,
  scrollRef,
  onTaskEdit,
  onDependencyClick,
  onTaskUpdate,
  onTaskDelete,
  onPushToGantt,
  onSendToVault,
  onArchiveTask,
  onTaskCreate,
}: VirtualizedTaskListProps) {
  const dense = tasks.length >= DENSE_THRESHOLD

  const renderCard = (task: TaskItem) => (
    <SortableTaskCard
      key={task.id}
      task={task}
      onEdit={onTaskEdit}
      onDependencyClick={onDependencyClick}
      columnGlowColor={glowColor}
      showDropIndicator={overId === task.id && activeTaskId !== task.id}
      onTaskUpdate={onTaskUpdate}
      onTaskDelete={onTaskDelete}
      onPushToGantt={onPushToGantt}
      onSendToVault={onSendToVault}
      onArchiveTask={onArchiveTask}
      animateOnMount={!dense}
    />
  )

  return (
    // overscroll-y-contain: hitting the top/bottom of a card list must not
    // chain into page scroll / pull-to-refresh mid-gesture. y-axis only — an
    // all-axis contain would swallow horizontal swipes that should pan the
    // board row underneath.
    // flex-auto (basis:auto), NOT flex-1 (basis:0%): the column box is
    // height:auto now, and WebKit resolves a percentage basis against an
    // indefinite container as 0 — collapsing every card list on iOS. A
    // content basis + min-h-0 sizes the column by its cards and still lets
    // this scroller shrink and scroll once the viewport cap engages.
    <div ref={scrollRef} data-col-scroll className="flex-auto min-h-0 overflow-y-auto overscroll-y-contain p-3 space-y-3">
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {dense ? (
          // No AnimatePresence on dense columns: with many cards its layout
          // bookkeeping is the expensive part, and content-visibility already
          // keeps offscreen cards cheap.
          tasks.map((task) => (
            <div
              key={task.id}
              style={{
                contentVisibility: 'auto',
                containIntrinsicSize: `auto ${ESTIMATED_CARD_HEIGHT}px`,
              }}
            >
              {renderCard(task)}
            </div>
          ))
        ) : (
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => renderCard(task))}
          </AnimatePresence>
        )}
      </SortableContext>
      <div className="mt-2">
        <QuickAddTask projectId={projectId} columnId={columnId} onTaskCreate={onTaskCreate} />
      </div>
    </div>
  )
})
