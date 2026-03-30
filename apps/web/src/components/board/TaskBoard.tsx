'use client'

import { useCallback, useState, useMemo } from 'react'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useBoardStore, useColumns, useTasks, useSelectedTaskId, type BoardColumn } from '@/lib/store/boardStore'
import { KanbanColumn } from './KanbanColumn'
import { SortableColumn } from './SortableColumn'
import { TaskEditModal } from './TaskEditModal'
import { BoardFilterBar } from './BoardFilterBar'
import { DependencyGlowTree } from './DependencyGlowTree'
import { LabelPicker } from './LabelPicker'
import { TaskColorPicker } from './TaskColorPicker'
import { TaskPriorityPicker } from './TaskPriorityPicker'
import { TrashDropZone } from './TrashDropZone'
import { DragPreview } from './DragPreview'
import { ConnectModeBanner } from './ConnectModeBanner'
import { BoardGlowBackground } from './BoardGlowBackground'
import { AddColumnButton } from './AddColumnButton'
import { generateId, pickUniqueColor } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import { applyBoardFilters, DEFAULT_FILTERS } from '@/lib/utils/boardFilters'
import type { BoardFilters } from '@/lib/utils/boardFilters'
import { useBoardDnD } from './useBoardDnD'
import { useBoardKeyboardShortcuts } from './useBoardKeyboardShortcuts'
import { useBoardHover } from './useBoardHover'
import { useConnectMode } from './useConnectMode'
import { duplicateBoardTask } from '@/lib/actions/board'
import { toast } from '@/components/ui/Toast'

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
  size?: number | null
  ganttTaskId?: string | null
}

interface TaskBoardProps {
  projectId: string
  showFilters?: boolean
  filters?: BoardFilters
  onFiltersChange?: (filters: BoardFilters) => void
  onTaskCreate?: (task: BoardTaskData) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>) => void
  onTaskDelete?: (taskId: string) => void
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onColumnCreate?: (column: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => void
  onColumnUpdate?: (columnId: string, updates: Partial<BoardColumn>) => void
  onColumnReorder?: (updates: { id: string; orderIndex: number }[]) => void
  onColumnDelete?: (columnId: string) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  showAllDeps?: boolean
  onShowAllDepsChange?: (v: boolean) => void
  connectMode?: boolean
  onConnectModeChange?: (v: boolean) => void
  onPushToGantt?: (taskId: string) => void
  onSendToVault?: (taskId: string) => void
  onVaultCompleted?: (columnId: string) => void
  onArchiveTask?: (taskId: string) => void
  onArchiveColumn?: (columnId: string) => void
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
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
  showAllDeps,
  onShowAllDepsChange,
  connectMode,
  onConnectModeChange,
  onPushToGantt,
  onSendToVault,
  onVaultCompleted,
  onArchiveTask,
  onArchiveColumn,
}: TaskBoardProps) {
  const columns = useColumns()
  const tasks = useTasks()
  const selectedTaskId = useSelectedTaskId()
  const addTask = useBoardStore((s) => s.addTask)
  const updateTask = useBoardStore((s) => s.updateTask)
  const selectTask = useBoardStore((s) => s.selectTask)
  const addColumn = useBoardStore((s) => s.addColumn)
  const updateColumn = useBoardStore((s) => s.updateColumn)
  const removeColumn = useBoardStore((s) => s.removeColumn)
  const { colors: themeColors, glowIntensity: globalGlow, dragEffect, shortcuts, boardLayout } = useThemeStore()

  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [internalFilters, setInternalFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [dependencyTreeTaskId, setDependencyTreeTaskId] = useState<string | null>(null)
  const [labelPickerTaskId, setLabelPickerTaskId] = useState<string | null>(null)
  const [colorPickerTaskId, setColorPickerTaskId] = useState<string | null>(null)
  const [priorityPickerTaskId, setPriorityPickerTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'purple' as string,
    priority: 'medium' as typeof PRIORITIES[number],
    size: null as number | null,
  })

  const showFilters = showFiltersFromParent ?? false
  const filters = filtersFromParent ?? internalFilters
  const setFilters = onFiltersChange ?? setInternalFilters

  const sortedColumns = useMemo(
    () => columns.filter((c) => c.projectId === projectId).sort((a, b) => a.orderIndex - b.orderIndex),
    [columns, projectId]
  )

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId), [tasks, projectId])
  const filteredTasks = useMemo(() => applyBoardFilters(projectTasks, filters), [projectTasks, filters])
  const columnIds = sortedColumns.map((c) => c.id)

  const { boardRef, hoveredTaskId } = useBoardHover()

  const { connectSourceId, cursorPos, handleConnectClick, cancelConnect } = useConnectMode({
    connectMode,
    onAddDependency,
    onConnectModeChange,
  })

  const { sensors, activeItem, overId, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel } = useBoardDnD({
    projectTasks,
    sortedColumns,
    onTaskMove,
    onTaskDelete,
    onColumnReorder,
  })

  const handleAddTask = useCallback((columnId: string) => {
    setFormData({ name: '', description: '', color: 'purple', priority: 'medium', size: null })
    setNewTaskColumnId(columnId)
    setEditingTask(null)
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
        size: task.size ?? null,
      })
      setEditingTask(taskId)
      setNewTaskColumnId(null)
    }
  }, [tasks, selectTask])

  const handleTaskClick = useCallback((taskId: string) => {
    handleConnectClick(taskId, handleTaskEdit)
  }, [handleConnectClick, handleTaskEdit])

  const handleCopyCard = useCallback((taskId: string) => {
    setCopiedTaskId(taskId)
    toast('Card copied')
  }, [])

  const handlePasteCard = useCallback(() => {
    if (!copiedTaskId) return
    const { tasks: storeTasks, addTask: storeAddTask, checklistSummaries, setChecklistSummaries } = useBoardStore.getState()
    const source = storeTasks.find(t => t.id === copiedTaskId)
    if (!source) return

    const newId = generateId()
    const columnTasks = storeTasks.filter(t => t.columnId === source.columnId)
    const maxOrder = columnTasks.reduce((max, t) => Math.max(max, t.orderIndex), -1)

    const newTask = {
      ...source,
      id: newId,
      name: `Copy of ${source.name}`,
      orderIndex: maxOrder + 1,
    }
    storeAddTask(newTask)

    if (checklistSummaries[copiedTaskId]) {
      setChecklistSummaries({ ...checklistSummaries, [newId]: { ...checklistSummaries[copiedTaskId] } })
    }

    duplicateBoardTask(copiedTaskId, projectId, newId).catch(() => {
      useBoardStore.getState().removeTask(newId)
      toast('Failed to duplicate card')
    })
  }, [copiedTaskId, projectId])

  const hasOpenOverlay = !!editingTask || !!newTaskColumnId || !!labelPickerTaskId || !!colorPickerTaskId || !!priorityPickerTaskId || !!dependencyTreeTaskId

  useBoardKeyboardShortcuts({
    hoveredTaskId,
    selectedTaskId,
    shortcuts,
    sortedColumns,
    hasOpenOverlay,
    onOpenLabel: setLabelPickerTaskId,
    onOpenColorPicker: setColorPickerTaskId,
    onOpenPriorityPicker: setPriorityPickerTaskId,
    onEditCard: handleTaskEdit,
    onAddTask: handleAddTask,
    onCopyCard: handleCopyCard,
    onPasteCard: handlePasteCard,
    onSelectTask: selectTask,
    onTaskMove,
  })

  const handleColumnRename = useCallback((columnId: string, name: string) => {
    updateColumn(columnId, { name })
    onColumnUpdate?.(columnId, { name })
  }, [updateColumn, onColumnUpdate])

  const handleColumnColorChange = useCallback((columnId: string, color: string) => {
    updateColumn(columnId, { color })
    onColumnUpdate?.(columnId, { color })
  }, [updateColumn, onColumnUpdate])

  const handleColumnIconChange = useCallback((columnId: string, icon: string | null) => {
    updateColumn(columnId, { icon })
    onColumnUpdate?.(columnId, { icon })
  }, [updateColumn, onColumnUpdate])

  const handleColumnDelete = useCallback((columnId: string) => {
    removeColumn(columnId)
    onColumnDelete?.(columnId)
  }, [removeColumn, onColumnDelete])

  const handleAddColumn = useCallback(() => {
    const usedColors = sortedColumns.map(c => c.color).filter(Boolean)
    const newCol: BoardColumn = {
      id: generateId(),
      projectId,
      name: 'New Column',
      color: pickUniqueColor(usedColors),
      icon: null,
      orderIndex: sortedColumns.length,
    }
    addColumn(newCol)
    onColumnCreate?.({ id: newCol.id, projectId, name: newCol.name, color: newCol.color, orderIndex: newCol.orderIndex })
  }, [projectId, sortedColumns, addColumn, onColumnCreate])

  const handleSubmit = useCallback(() => {
    if (!formData.name.trim()) return

    if (editingTask) {
      const updates = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        color: formData.color,
        priority: formData.priority,
        size: formData.size,
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
      requestAnimationFrame(() => {
        document.querySelector(`[data-task-id="${CSS.escape(newTask.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
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

      <div ref={boardRef} data-board-export className="relative">
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
            <div
              data-board-columns
              className={boardLayout === 'grid'
                ? 'flex flex-wrap gap-3 sm:gap-4 pb-4 overflow-x-hidden overflow-y-auto sm:overflow-auto content-start sm:max-h-[calc(100dvh-140px)]'
                : 'flex flex-nowrap gap-3 sm:gap-4 pb-4 overflow-x-auto overflow-y-hidden sm:overflow-auto sm:max-h-[calc(100dvh-140px)]'
              }
              style={activeItem ? { willChange: 'transform' } : undefined}
            >
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
                      onColumnIconChange={handleColumnIconChange}
                      onColumnDelete={handleColumnDelete}
                      onTaskUpdate={onTaskUpdate}
                      onTaskDelete={onTaskDelete}
                      onPushToGantt={onPushToGantt}
                      onSendToVault={onSendToVault}
                      onVaultCompleted={onVaultCompleted}
                      onArchiveTask={onArchiveTask}
                      onArchiveColumn={onArchiveColumn}
                      overId={overId}
                      activeTaskId={activeItem?.type === 'task' ? (activeItem.data as BoardTaskData).id : null}
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
            {activeItem?.type === 'task' && <DragPreview task={activeItem.data as BoardTaskData} effect={dragEffect} globalGlow={globalGlow} />}
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
        onLabelToggle={onLabelToggle}
        onPushToGantt={onPushToGantt}
        onDateChange={(taskId, dates) => onTaskUpdate?.(taskId, dates as Record<string, unknown>)}
        onTaskDelete={onTaskDelete}
      />

      {dependencyTreeTaskId && (
        <DependencyGlowTree
          taskId={dependencyTreeTaskId}
          onClose={() => setDependencyTreeTaskId(null)}
          onTaskEdit={(id) => { setDependencyTreeTaskId(null); handleTaskEdit(id) }}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {showAllDeps && (
        <DependencyGlowTree
          taskId={null}
          showAll
          onClose={() => onShowAllDepsChange?.(false)}
          onTaskEdit={(id) => { onShowAllDepsChange?.(false); handleTaskEdit(id) }}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {labelPickerTaskId && (
        <LabelPicker
          taskId={labelPickerTaskId}
          projectId={projectId}
          isOpen={!!labelPickerTaskId}
          onClose={() => setLabelPickerTaskId(null)}
          onLabelCreate={onLabelCreate}
          onLabelUpdate={onLabelUpdate}
          onLabelDelete={onLabelDelete}
          onLabelToggle={onLabelToggle}
        />
      )}

      {colorPickerTaskId && (
        <TaskColorPicker
          taskId={colorPickerTaskId}
          isOpen={!!colorPickerTaskId}
          onClose={() => setColorPickerTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      {priorityPickerTaskId && (
        <TaskPriorityPicker
          taskId={priorityPickerTaskId}
          isOpen={!!priorityPickerTaskId}
          onClose={() => setPriorityPickerTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

      <ConnectModeBanner
        connectMode={connectMode ?? false}
        connectSourceId={connectSourceId}
        cursorPos={cursorPos}
        onCancel={cancelConnect}
      />
    </>
  )
}
