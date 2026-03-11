'use client'

import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { DndContext, DragEndEvent, DragStartEvent, DragOverEvent, DragOverlay, useSensor, useSensors, PointerSensor, closestCenter } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useBoardStore, type BoardColumn } from '@/lib/store/boardStore'
import { KanbanColumn } from './KanbanColumn'
import { SortableColumn } from './SortableColumn'
import { TaskEditModal } from './TaskEditModal'
import { BoardFilterBar } from './BoardFilterBar'
import { DependencyGlowTree } from './DependencyGlowTree'
import { BoardDependencyOverlay } from './BoardDependencyOverlay'
import { LabelPicker } from './LabelPicker'
import { TrashDropZone } from './TrashDropZone'
import { DragPreview } from './DragPreview'
import { ConnectModeBanner } from './ConnectModeBanner'
import { BoardGlowBackground } from './BoardGlowBackground'
import { AddColumnButton } from './AddColumnButton'
import { generateId } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import { applyBoardFilters, DEFAULT_FILTERS } from '@/lib/utils/boardFilters'
import type { BoardFilters } from '@/lib/utils/boardFilters'

interface BoardTaskData {
  id: string
  projectId: string
  name: string
  description?: string
  columnId?: string
  status: string
  priority: string
  color: string
  labels: string[]
  onTimeline: boolean
  orderIndex: number
  startDate?: string
  endDate?: string
}

interface TaskBoardProps {
  projectId: string
  showFilters?: boolean
  filters?: BoardFilters
  onFiltersChange?: (filters: BoardFilters) => void
  onTaskCreate?: (task: BoardTaskData) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>) => void
  onTaskDelete?: (taskId: string) => void
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string }[]) => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onColumnCreate?: (column: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => void
  onColumnUpdate?: (columnId: string, updates: Partial<BoardColumn>) => void
  onColumnReorder?: (updates: { id: string; orderIndex: number }[]) => void
  onColumnDelete?: (columnId: string) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  showDependencyOverlay?: boolean
  connectMode?: boolean
  onConnectModeChange?: (v: boolean) => void
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

export function TaskBoard({
  projectId,
  showFilters: showFiltersFromParent,
  filters: filtersFromParent,
  onFiltersChange,
  onTaskCreate,
  onTaskUpdate,
  onTaskDelete,
  onTaskMove,
  onAddDependency,
  onRemoveDependency,
  onColumnCreate,
  onColumnUpdate,
  onColumnReorder,
  onColumnDelete,
  onLabelCreate,
  onLabelToggle,
  showDependencyOverlay,
  connectMode,
  onConnectModeChange,
}: TaskBoardProps) {
  const {
    columns,
    tasks,
    moveTask,
    addTask,
    updateTask,
    removeTask,
    selectTask,
    selectedTaskId,
    addColumn,
    updateColumn,
    removeColumn,
    reorderColumns,
  } = useBoardStore()
  const { colors: themeColors, glowIntensity: globalGlow, dragEffect, shortcuts } = useThemeStore()
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: any } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [internalFilters, setInternalFilters] = useState<BoardFilters>(DEFAULT_FILTERS)

  const showFilters = showFiltersFromParent ?? false
  const filters = filtersFromParent ?? internalFilters
  const setFilters = onFiltersChange ?? setInternalFilters
  const [dependencyTreeTaskId, setDependencyTreeTaskId] = useState<string | null>(null)
  const [labelPickerTaskId, setLabelPickerTaskId] = useState<string | null>(null)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'purple' as string,
    priority: 'medium' as typeof PRIORITIES[number],
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const boardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-task-id]')
      setHoveredTaskId(el?.getAttribute('data-task-id') ?? null)
    }
    const onLeave = () => setHoveredTaskId(null)
    board.addEventListener('mouseover', onOver)
    board.addEventListener('mouseleave', onLeave)
    return () => {
      board.removeEventListener('mouseover', onOver)
      board.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    if (!connectMode) setConnectSourceId(null)
  }, [connectMode])

  useEffect(() => {
    if (!connectMode) return
    const onMove = (e: MouseEvent) => setCursorPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [connectMode])

  const sortedColumns = useMemo(
    () => columns.filter((c) => c.projectId === projectId).sort((a, b) => a.orderIndex - b.orderIndex),
    [columns, projectId]
  )

  const projectTasks = tasks.filter((t) => t.projectId === projectId)
  const filteredTasks = useMemo(() => applyBoardFilters(projectTasks, filters), [projectTasks, filters])
  const columnIds = sortedColumns.map((c) => c.id)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const dragType = active.data.current?.type

    if (dragType === 'column') {
      const col = sortedColumns.find((c) => c.id === active.id)
      if (col) setActiveItem({ type: 'column', data: col })
    } else {
      const task = projectTasks.find((t) => t.id === active.id)
      if (task) setActiveItem({ type: 'task', data: task })
    }
  }, [projectTasks, sortedColumns])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) {
      setOverId(null)
      return
    }

    const activeType = active.data.current?.type
    const currentOverId = over.id as string
    setOverId(currentOverId)

    if (activeType === 'column') return

    const activeId = active.id as string
    const activeTask = projectTasks.find((t) => t.id === activeId)
    if (!activeTask) return

    const overTask = projectTasks.find((t) => t.id === currentOverId)
    const overColumnId = over.data.current?.columnId || (sortedColumns.find((c) => c.id === currentOverId)?.id)

    if (overTask && activeTask.columnId !== overTask.columnId) {
      moveTask(activeId, overTask.columnId!, overTask.orderIndex)
      onTaskMove?.([{ id: activeId, orderIndex: overTask.orderIndex, columnId: overTask.columnId }])
    } else if (overColumnId && activeTask.columnId !== overColumnId) {
      const tasksInColumn = projectTasks.filter((t) => t.columnId === overColumnId)
      moveTask(activeId, overColumnId, tasksInColumn.length)
      onTaskMove?.([{ id: activeId, orderIndex: tasksInColumn.length, columnId: overColumnId }])
    }
  }, [projectTasks, sortedColumns, moveTask, onTaskMove])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    const activeType = active.data.current?.type

    setActiveItem(null)
    setOverId(null)

    if (!over) return

    if (activeType === 'column') {
      const activeId = active.id as string
      const overId = over.id as string
      if (activeId === overId) return

      const oldIndex = sortedColumns.findIndex((c) => c.id === activeId)
      const newIndex = sortedColumns.findIndex((c) => c.id === overId)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(sortedColumns, oldIndex, newIndex)
      const updates = reordered.map((col, idx) => ({ id: col.id, orderIndex: idx }))
      reorderColumns(updates)
      onColumnReorder?.(updates)
      return
    }

    const activeId = active.id as string
    const overIdVal = over.id as string

    if (overIdVal === 'trash') {
      removeTask(activeId)
      onTaskDelete?.(activeId)
      return
    }

    const activeTask = projectTasks.find((t) => t.id === activeId)
    const overTask = projectTasks.find((t) => t.id === overIdVal)

    if (activeTask && overTask && activeTask.columnId === overTask.columnId && activeId !== overIdVal) {
      const columnTasks = projectTasks
        .filter((t) => t.columnId === activeTask.columnId)
        .sort((a, b) => a.orderIndex - b.orderIndex)

      const oldIndex = columnTasks.findIndex((t) => t.id === activeId)
      const newIndex = columnTasks.findIndex((t) => t.id === overIdVal)

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(columnTasks, oldIndex, newIndex)
        const moveUpdates: { id: string; orderIndex: number }[] = []
        reordered.forEach((task, index) => {
          if (task.orderIndex !== index) {
            updateTask(task.id, { orderIndex: index })
            moveUpdates.push({ id: task.id, orderIndex: index })
          }
        })
        if (moveUpdates.length > 0) onTaskMove?.(moveUpdates)
      }
    }
  }, [projectTasks, sortedColumns, removeTask, updateTask, reorderColumns, onTaskMove, onTaskDelete, onColumnReorder])

  const handleDragCancel = useCallback(() => {
    setActiveItem(null)
    setOverId(null)
  }, [])

  const handleTaskEdit = useCallback((taskId: string) => {
    selectTask(taskId)
    const task = tasks.find((t) => t.id === taskId)
    if (task) {
      setFormData({
        name: task.name,
        description: task.description || '',
        color: task.color,
        priority: task.priority,
      })
      setEditingTask(taskId)
      setNewTaskColumnId(null)
    }
  }, [tasks])

  const handleTaskClick = useCallback((taskId: string) => {
    if (!connectMode) {
      handleTaskEdit(taskId)
      return
    }
    if (!connectSourceId) {
      setConnectSourceId(taskId)
    } else if (taskId !== connectSourceId) {
      onAddDependency?.(connectSourceId, taskId)
      setConnectSourceId(null)
      onConnectModeChange?.(false)
    }
  }, [connectMode, connectSourceId, handleTaskEdit, onAddDependency, onConnectModeChange])

  const handleAddTask = useCallback((columnId: string) => {
    setFormData({ name: '', description: '', color: 'purple', priority: 'medium' })
    setNewTaskColumnId(columnId)
    setEditingTask(null)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const key = e.key.toLowerCase()

      const targetTaskId = hoveredTaskId ?? selectedTaskId
      if (key === (shortcuts?.openLabel ?? 'l') && targetTaskId) {
        e.preventDefault()
        setLabelPickerTaskId(targetTaskId)
        return
      }

      if (key === (shortcuts?.addTask ?? 't') && sortedColumns.length > 0) {
        e.preventDefault()
        handleAddTask(sortedColumns[0].id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, hoveredTaskId, shortcuts, sortedColumns, handleAddTask])

  const handleColumnRename = useCallback((columnId: string, name: string) => {
    updateColumn(columnId, { name })
    onColumnUpdate?.(columnId, { name })
  }, [updateColumn, onColumnUpdate])

  const handleColumnColorChange = useCallback((columnId: string, color: string) => {
    updateColumn(columnId, { color })
    onColumnUpdate?.(columnId, { color })
  }, [updateColumn, onColumnUpdate])

  const handleColumnDelete = useCallback((columnId: string) => {
    removeColumn(columnId)
    onColumnDelete?.(columnId)
  }, [removeColumn, onColumnDelete])

  const handleAddColumn = useCallback(() => {
    const newCol: BoardColumn = {
      id: generateId(),
      projectId,
      name: 'New Column',
      color: 'purple',
      icon: null,
      orderIndex: sortedColumns.length,
    }
    addColumn(newCol)
    onColumnCreate?.({ id: newCol.id, projectId, name: newCol.name, color: newCol.color, orderIndex: newCol.orderIndex })
  }, [projectId, sortedColumns.length, addColumn, onColumnCreate])

  const handleSubmit = useCallback(() => {
    if (!formData.name.trim()) return

    if (editingTask) {
      const updates = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        color: formData.color,
        priority: formData.priority,
      }
      updateTask(editingTask, updates)
      onTaskUpdate?.(editingTask, updates)
      setEditingTask(null)
    } else if (newTaskColumnId) {
      const maxOrder = Math.max(0, ...projectTasks.filter((t) => t.columnId === newTaskColumnId).map((t) => t.orderIndex))
      const newTask = {
        id: generateId(),
        projectId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        columnId: newTaskColumnId,
        status: 'todo',
        priority: formData.priority,
        color: formData.color,
        labels: [],
        onTimeline: false,
        orderIndex: maxOrder + 1,
      }
      addTask(newTask)
      onTaskCreate?.(newTask)
      setNewTaskColumnId(null)
    }
  }, [formData, editingTask, newTaskColumnId, projectTasks, projectId, updateTask, addTask, onTaskCreate, onTaskUpdate])

  const closeModal = () => {
    setEditingTask(null)
    setNewTaskColumnId(null)
  }

  const isModalOpen = editingTask !== null || newTaskColumnId !== null
  const isTaskDrag = activeItem?.type === 'task'

  return (
    <>
      <BoardGlowBackground glowColor={themeColors.glowColor} globalGlow={globalGlow} />

      <div ref={boardRef} className="relative">
        <BoardFilterBar
          isOpen={showFilters}
          filters={filters}
          onFiltersChange={setFilters}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={columnIds} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-4 pb-4 overflow-auto content-start" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              {sortedColumns.map((column) => (
                <SortableColumn key={column.id} column={column}>
                  {(dragHandleProps) => (
                    <KanbanColumn
                      column={column}
                      projectId={projectId}
                      tasks={filteredTasks
                        .filter((t) => t.columnId === column.id)
                        .sort((a, b) => a.orderIndex - b.orderIndex)}
                      onTaskEdit={handleTaskClick}
                      onAddTask={() => handleAddTask(column.id)}
                      onTaskCreate={onTaskCreate}
                      onColumnRename={handleColumnRename}
                      onColumnColorChange={handleColumnColorChange}
                      onColumnDelete={handleColumnDelete}
                      onTaskUpdate={onTaskUpdate}
                      onTaskDelete={onTaskDelete}
                      overId={overId}
                      activeTaskId={activeItem?.type === 'task' ? activeItem.data?.id : null}
                      onDependencyClick={setDependencyTreeTaskId}
                      dragHandleProps={dragHandleProps}
                    />
                  )}
                </SortableColumn>
              ))}

              <AddColumnButton onClick={handleAddColumn} />
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={{ duration: 300, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeItem?.type === 'task' && <DragPreview task={activeItem.data} effect={dragEffect} globalGlow={globalGlow} />}
          </DragOverlay>

          <TrashDropZone isActive={isTaskDrag} />
        </DndContext>
      </div>

      <TaskEditModal
        isOpen={isModalOpen}
        editingTaskId={editingTask}
        newTaskStatus={newTaskColumnId}
        formData={formData}
        projectId={projectId}
        onFormChange={setFormData}
        onSubmit={handleSubmit}
        onClose={closeModal}
        onAddDependency={onAddDependency}
        onRemoveDependency={onRemoveDependency}
      />

      {dependencyTreeTaskId && (
        <DependencyGlowTree
          taskId={dependencyTreeTaskId}
          onClose={() => setDependencyTreeTaskId(null)}
        />
      )}

      {labelPickerTaskId && (
        <LabelPicker
          taskId={labelPickerTaskId}
          projectId={projectId}
          isOpen={!!labelPickerTaskId}
          onClose={() => setLabelPickerTaskId(null)}
          onLabelCreate={onLabelCreate}
          onLabelToggle={onLabelToggle}
        />
      )}

      <BoardDependencyOverlay enabled={showDependencyOverlay ?? false} />

      <ConnectModeBanner
        connectMode={connectMode ?? false}
        connectSourceId={connectSourceId}
        cursorPos={cursorPos}
        onCancel={() => { onConnectModeChange?.(false); setConnectSourceId(null) }}
      />
    </>
  )
}
