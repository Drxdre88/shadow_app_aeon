'use client'

import { useMemo, useCallback } from 'react'
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core'
import { differenceInDays, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { useGanttStore } from '@/lib/store/ganttStore'
import { useBoardStore } from '@/lib/store/boardStore'
import { TimelineHeader } from './TimelineHeader'
import { RowContainer } from './RowContainer'
import { TaskBar } from './TaskBar'
import { AccentColor } from '@/lib/utils/colors'

interface GanttChartProps {
  projectId: string
  startDate: Date
  endDate: Date
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskClick?: (boardTaskId: string) => void
}

const CELL_WIDTHS = { day: 120, week: 100, month: 150 }
const MS_PER_DAY = 86400000
const BAR_HEIGHT = 40
const BAR_GAP = 4
const ROW_PADDING = 8
const MIN_ROW_HEIGHT = 56

export function GanttChart({ projectId, startDate, endDate, onTaskUpdate, onTaskClick }: GanttChartProps) {
  const { tasks, rows, views, activeViewId, timeScale, updateTask } = useGanttStore()
  const boardTasks = useBoardStore((s) => s.tasks)

  const activeView = views.find((v) => v.id === activeViewId)
  const allowMultipleRows = (activeView?.filters?.allowMultipleRows as boolean) ?? false
  const allowOverlap = (activeView?.filters?.allowOverlap as boolean) ?? false

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const doneTaskIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of boardTasks) {
      if (t.status === 'done') set.add(t.id)
    }
    return set
  }, [boardTasks])

  const cellWidth = CELL_WIDTHS[timeScale]
  const projectTasks = tasks.filter((t) => t.projectId === projectId && !(t.boardTaskId && doneTaskIds.has(t.boardTaskId)))
  const projectRows = rows
    .filter((r) => r.projectId === projectId && activeViewId && r.ganttViewId === activeViewId)
    .sort((a, b) => a.orderIndex - b.orderIndex)

  const rowTaskMap = useMemo(() => {
    const map = new Map<string, typeof projectTasks>()
    for (const row of projectRows) {
      map.set(row.id, projectTasks.filter((t) => t.rowId === row.id))
    }
    return map
  }, [projectRows, projectTasks])

  const laneAssignments = useMemo(() => {
    const assignments = new Map<string, number>()
    if (!allowMultipleRows) {
      for (const [, rowTasks] of rowTaskMap) {
        for (const task of rowTasks) {
          assignments.set(task.id, 0)
        }
      }
      return assignments
    }
    for (const [, rowTasks] of rowTaskMap) {
      const lanes: { end: number }[] = []
      const sorted = [...rowTasks].sort((a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      )
      for (const task of sorted) {
        const taskStart = new Date(task.startDate).getTime()
        let assignedLane = -1
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i].end <= taskStart) {
            assignedLane = i
            break
          }
        }
        if (assignedLane === -1) {
          assignedLane = lanes.length
          lanes.push({ end: 0 })
        }
        lanes[assignedLane].end = new Date(task.endDate).getTime()
        assignments.set(task.id, assignedLane)
      }
    }
    return assignments
  }, [rowTaskMap, allowMultipleRows])

  const getRowLaneCount = useCallback((rowId: string) => {
    const rowTasks = rowTaskMap.get(rowId) ?? []
    if (rowTasks.length === 0) return 1
    let maxLane = 0
    for (const t of rowTasks) {
      maxLane = Math.max(maxLane, (laneAssignments.get(t.id) ?? 0) + 1)
    }
    return maxLane
  }, [rowTaskMap, laneAssignments])

  const getRowHeight = useCallback((rowId: string) => {
    const laneCount = getRowLaneCount(rowId)
    if (laneCount <= 1) return MIN_ROW_HEIGHT
    return Math.max(MIN_ROW_HEIGHT, laneCount * (BAR_HEIGHT + BAR_GAP) + ROW_PADDING)
  }, [getRowLaneCount])

  const timeColumns = useMemo(() => {
    switch (timeScale) {
      case 'day':
        return eachDayOfInterval({ start: startDate, end: endDate })
      case 'week':
        return eachWeekOfInterval({ start: startDate, end: endDate })
      case 'month':
        return eachMonthOfInterval({ start: startDate, end: endDate })
    }
  }, [startDate, endDate, timeScale])

  const getTaskStyle = useCallback((task: typeof projectTasks[0]) => {
    const taskStart = new Date(task.startDate)
    const taskEnd = new Date(task.endDate)
    const lane = laneAssignments.get(task.id) ?? 0

    const dayOffset = differenceInDays(taskStart, startDate)
    const daySpan = Math.max(1, differenceInDays(taskEnd, taskStart))

    let left: number
    let width: number

    switch (timeScale) {
      case 'day':
        left = dayOffset * cellWidth
        width = daySpan * cellWidth
        break
      case 'week':
        left = (dayOffset / 7) * cellWidth
        width = Math.max((daySpan / 7) * cellWidth, 20)
        break
      case 'month':
        left = (dayOffset / 30) * cellWidth
        width = Math.max((daySpan / 30) * cellWidth, 20)
        break
    }

    return {
      left,
      width: Math.max(width - 4, 20),
      top: lane * (BAR_HEIGHT + BAR_GAP) + BAR_GAP,
    }
  }, [startDate, cellWidth, timeScale, laneAssignments])

  const cascadePush = useCallback((movedTaskId: string, rowId: string) => {
    const rowTasks = (rowTaskMap.get(rowId) ?? [])
      .map((t) => {
        const current = useGanttStore.getState().tasks.find((s) => s.id === t.id)
        return current ?? t
      })
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())

    for (let i = 0; i < rowTasks.length - 1; i++) {
      const current = rowTasks[i]
      const next = rowTasks[i + 1]
      const currentEnd = new Date(current.endDate).getTime()
      const nextStart = new Date(next.startDate).getTime()
      if (currentEnd > nextStart) {
        const nextDuration = new Date(next.endDate).getTime() - nextStart
        const newStart = new Date(currentEnd)
        const newEnd = new Date(currentEnd + nextDuration)
        const updates = {
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
        }
        updateTask(next.id, updates)
        onTaskUpdate?.(next.id, updates)
      }
    }
  }, [rowTaskMap, updateTask, onTaskUpdate])

  const handleResize = useCallback((taskId: string, edge: 'left' | 'right', daysDelta: number) => {
    const task = projectTasks.find((t) => t.id === taskId)
    if (!task) return
    let dateUpdates: { startDate?: string; endDate?: string }
    if (edge === 'left') {
      const newStart = new Date(new Date(task.startDate).getTime() + daysDelta * MS_PER_DAY)
      if (newStart >= new Date(task.endDate)) return
      dateUpdates = { startDate: newStart.toISOString() }
    } else {
      const newEnd = new Date(new Date(task.endDate).getTime() + daysDelta * MS_PER_DAY)
      if (newEnd <= new Date(task.startDate)) return
      dateUpdates = { endDate: newEnd.toISOString() }
    }
    updateTask(taskId, dateUpdates)
    onTaskUpdate?.(taskId, dateUpdates)

    if (!allowOverlap && task.rowId) {
      requestAnimationFrame(() => cascadePush(taskId, task.rowId!))
    }
  }, [projectTasks, updateTask, onTaskUpdate, allowOverlap, cascadePush])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event
    if (!over) return

    const task = projectTasks.find((t) => t.id === active.id)
    if (!task) return

    let daysMoved: number
    if (timeScale === 'day') {
      const halfDaysMoved = Math.round((delta.x / (cellWidth / 2)))
      daysMoved = halfDaysMoved * 0.5
    } else {
      const daysPerCell = timeScale === 'week' ? 7 : 30
      daysMoved = Math.round((delta.x / cellWidth) * daysPerCell)
    }

    const targetRowId = (over.data.current?.type === 'row' && over.id !== task.rowId)
      ? over.id as string
      : task.rowId

    if (over.data.current?.type === 'row' && over.id !== task.rowId) {
      const rowUpdate = { rowId: over.id as string }
      updateTask(task.id, rowUpdate)
      onTaskUpdate?.(task.id, rowUpdate)
    }

    if (daysMoved !== 0) {
      const newStart = new Date(new Date(task.startDate).getTime() + daysMoved * MS_PER_DAY)
      const newEnd = new Date(new Date(task.endDate).getTime() + daysMoved * MS_PER_DAY)
      const dateUpdates = {
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString(),
      }
      updateTask(task.id, dateUpdates)
      onTaskUpdate?.(task.id, dateUpdates)
    }

    if (!allowOverlap && targetRowId) {
      requestAnimationFrame(() => cascadePush(task.id, targetRowId))
    }
  }, [projectTasks, updateTask, onTaskUpdate, cellWidth, timeScale, allowOverlap, cascadePush])

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="bg-white/5 backdrop-blur-xl rounded-xl overflow-auto border border-white/10" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <div style={{ minWidth: timeColumns.length * cellWidth + 192 }}>
          <TimelineHeader
            startDate={startDate}
            endDate={endDate}
            timeScale={timeScale}
            cellWidth={cellWidth}
          />

          {projectRows.map((row, index) => {
            const rowTasks = rowTaskMap.get(row.id) ?? []
            return (
              <RowContainer
                key={row.id}
                row={row}
                height={getRowHeight(row.id)}
                isEven={index % 2 === 0}
              >
                {rowTasks.map((task) => (
                  <TaskBar
                    key={task.id}
                    task={task as { id: string; name: string; color: AccentColor; progress: number; boardTaskId?: string | null }}
                    style={getTaskStyle(task)}
                    cellWidth={cellWidth}
                    timeScale={timeScale}
                    onTaskClick={onTaskClick}
                    onResize={handleResize}
                  />
                ))}
              </RowContainer>
            )
          })}
        </div>
      </div>
    </DndContext>
  )
}
