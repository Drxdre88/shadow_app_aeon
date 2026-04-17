'use client'

import { useRef, useState, useLayoutEffect, useEffect, memo } from 'react'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const useVirtual = tasks.length >= VIRTUAL_THRESHOLD
  const [measured, setMeasured] = useState(false)

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    gap: CARD_GAP,
    enabled: useVirtual,
  })

  useLayoutEffect(() => {
    if (useVirtual) {
      virtualizer.measure()
    }
  }, [tasks.length, useVirtual, virtualizer])

  const hasMounted = useRef(false)
  useEffect(() => {
    if (!useVirtual) { setMeasured(false); hasMounted.current = false; return }
    if (hasMounted.current) return
    hasMounted.current = true
    const raf = requestAnimationFrame(() => setMeasured(true))
    return () => cancelAnimationFrame(raf)
  }, [useVirtual, tasks.length])

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
    />
  )

  if (useVirtual) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              opacity: measured ? 1 : 0,
              transition: 'opacity 0.15s ease-in',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const task = tasks[virtualItem.index]
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
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
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
