'use client'

import { useMemo, useCallback } from 'react'
import { DndContext, DragEndEvent, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { differenceInDays, differenceInWeeks, differenceInMonths, addDays, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { useGanttStore } from '@/lib/store/ganttStore'
import { TimelineHeader } from './TimelineHeader'
import { RowContainer } from './RowContainer'
import { TaskBar } from './TaskBar'
import { AccentColor } from '@/lib/utils/colors'

interface GanttChartProps {
  projectId: string
  startDate: Date
  endDate: Date
}

const CELL_WIDTHS = { day: 60, week: 100, month: 150 }
const ROW_HEIGHT = 56

export function GanttChart({ projectId, startDate, endDate }: GanttChartProps) {
  const { tasks, rows, timeScale, updateTask } = useGanttStore()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const cellWidth = CELL_WIDTHS[timeScale]
  const projectTasks = tasks.filter((t) => t.projectId === projectId)
  const projectRows = rows
    .filter((r) => r.projectId === projectId)
    .sort((a, b) => a.orderIndex - b.orderIndex)

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
    const rowIndex = projectRows.findIndex((r) => r.id === task.rowId)

    let startOffset: number
    let duration: number

    switch (timeScale) {
      case 'day':
        startOffset = differenceInDays(taskStart, startDate)
        duration = differenceInDays(taskEnd, taskStart) + 1
        break
      case 'week':
        startOffset = differenceInWeeks(taskStart, startDate, { roundingMethod: 'floor' })
        duration = Math.max(1, differenceInWeeks(taskEnd, taskStart, { roundingMethod: 'ceil' }) + 1)
        break
      case 'month':
        startOffset = differenceInMonths(taskStart, startDate)
        duration = Math.max(1, differenceInMonths(taskEnd, taskStart) + 1)
        break
    }

    return {
      left: startOffset * cellWidth,
      width: Math.max(duration * cellWidth - 8, 40),
      top: rowIndex * ROW_HEIGHT + 8,
    }
  }, [startDate, projectRows, cellWidth, timeScale])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over, delta } = event
    if (!over) return

    const task = projectTasks.find((t) => t.id === active.id)
    if (!task) return

    const daysPerCell = timeScale === 'day' ? 1 : timeScale === 'week' ? 7 : 30
    const daysMoved = Math.round((delta.x / cellWidth) * daysPerCell)

    if (daysMoved !== 0) {
      const newStart = addDays(new Date(task.startDate), daysMoved)
      const newEnd = addDays(new Date(task.endDate), daysMoved)
      updateTask(task.id, {
        startDate: newStart.toISOString(),
        endDate: newEnd.toISOString(),
      })
    }

    if (over.data.current?.type === 'row' && over.id !== task.rowId) {
      updateTask(task.id, { rowId: over.id as string })
    }
  }, [projectTasks, updateTask, cellWidth, timeScale])

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="bg-white/5 backdrop-blur-xl rounded-xl overflow-hidden border border-white/10">
        <TimelineHeader
          startDate={startDate}
          endDate={endDate}
          timeScale={timeScale}
          cellWidth={cellWidth}
        />

        <div className="relative overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <div style={{ minWidth: timeColumns.length * cellWidth + 192 }}>
            {projectRows.map((row, index) => (
              <RowContainer
                key={row.id}
                row={row as { id: string; name: string; color: AccentColor }}
                height={ROW_HEIGHT}
                isEven={index % 2 === 0}
              >
                {projectTasks
                  .filter((t) => t.rowId === row.id)
                  .map((task) => (
                    <TaskBar
                      key={task.id}
                      task={task as { id: string; name: string; color: AccentColor; progress: number }}
                      style={getTaskStyle(task)}
                    />
                  ))}
              </RowContainer>
            ))}
          </div>
        </div>
      </div>
    </DndContext>
  )
}
