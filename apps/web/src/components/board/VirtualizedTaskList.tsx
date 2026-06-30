'use client'

import { useState, memo } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SortableTaskCard } from './SortableTaskCard'
import { QuickAddTask } from './QuickAddTask'

const VIRTUAL_THRESHOLD = 15
const ESTIMATED_CARD_HEIGHT = 160
const VIRTUAL_OVERSCAN = 5
const CARD_GAP = 12

type TaskItem = {
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

interface VirtualizedTaskListProps {
  tasks: TaskItem[]
  taskIds: string[]
  columnId: string
  projectId: string
  glowColor: string
  overId?: string | null
  activeTaskId?: string | null
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
    orderIndex: number
  }) => void
}

export const VirtualizedTaskList = memo(function VirtualizedTaskList({
  tasks,
  taskIds,
  columnId,
  projectId,
  glowColor,
  overId,
  activeTaskId,
  onTaskEdit,
  onDependencyClick,
  onTaskUpdate,
  onTaskDelete,
  onPushToGantt,
  onSendToVault,
  onArchiveTask,
  onTaskCreate,
}: VirtualizedTaskListProps) {
  // Callback ref via useState: forces a re-render when the scroll element
  // attaches, so the virtualizer's getScrollElement() never returns null on
  // its first measurement pass. Using useRef here was the source of the
  // blank-column bug — the virtualizer measured against null and cached an
  // empty viewport until the next manual measure().
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const useVirtual = tasks.length >= VIRTUAL_THRESHOLD

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    gap: CARD_GAP,
    enabled: useVirtual,
    // Key measured heights by task id, NOT by row index (the default). Without
    // this, a reorder (drag, or a Pusher/poll resync that changes orderIndex)
    // leaves each slot's cached height pointing at whatever card USED to sit
    // there — tall card in a short slot (overlap) or short card in a tall slot
    // (gap). Keying by id makes each card carry its own height across reorders,
    // so we no longer need to wipe the whole cache on every resync (which was
    // snapping every card back to the flat estimate and causing the flicker).
    getItemKey: (index) => taskIds[index],
  })

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
      animateOnMount={!useVirtual}
    />
  )

  if (useVirtual) {
    return (
      <div ref={setScrollEl} className="flex-1 overflow-y-auto p-3">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const task = tasks[virtualItem.index]
              if (!task) return null
              return (
                <div
                  key={task.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  {renderCard(task)}
                </div>
              )
            })}
          </div>
        </SortableContext>
        <div className="mt-3">
          <QuickAddTask projectId={projectId} columnId={columnId} onTaskCreate={onTaskCreate} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => renderCard(task))}
        </AnimatePresence>
      </SortableContext>
      <div className="mt-2">
        <QuickAddTask projectId={projectId} columnId={columnId} onTaskCreate={onTaskCreate} />
      </div>
    </div>
  )
})
