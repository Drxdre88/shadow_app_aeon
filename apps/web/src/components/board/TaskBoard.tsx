'use client'

import { useCallback, useState, useMemo, useRef, useEffect } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useBoardStore, useColumns, useTasks, useSelectedTaskId, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { KanbanColumn } from './KanbanColumn'
import { SortableColumn } from './SortableColumn'
import { TaskEditModal } from './TaskEditModal'
import { TaskAssigneeOverlay } from './TaskAssigneeOverlay'
import { BoardFilterBar } from './BoardFilterBar'
import { DependencyGlowTree } from './DependencyGlowTree'
import { LabelPicker } from './LabelPicker'
import { TaskColorPicker } from './TaskColorPicker'
import { TaskPriorityPicker } from './TaskPriorityPicker'
import { TaskProgressPopover } from './TaskProgressPopover'
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
import { boardCollisionDetection } from './boardCollision'
import { useBoardKeyboardShortcuts } from './useBoardKeyboardShortcuts'
import { useBoardHover } from './useBoardHover'
import { cycleTaskCompletion } from './triState'
import { useConnectMode } from './useConnectMode'
import { duplicateBoardTask } from '@/lib/actions/board'
import { toast } from '@/components/ui/Toast'

const EMPTY_TASKS: BoardTask[] = []

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
  progress?: number | null
  ganttTaskId?: string | null
}

interface TaskBoardProps {
  projectId: string
  showFilters?: boolean
  filters?: BoardFilters
  onFiltersChange?: (filters: BoardFilters) => void
  onTaskCreate?: (task: BoardTaskData) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>, options?: { silent?: boolean }) => void
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
  const { colors: themeColors, glowIntensity: globalGlow, dragEffect, shortcuts, boardLayout, smoothUiRenders } = useThemeStore()

  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [internalFilters, setInternalFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [dependencyTreeTaskId, setDependencyTreeTaskId] = useState<string | null>(null)
  const [labelPickerTaskId, setLabelPickerTaskId] = useState<string | null>(null)
  const [colorPickerTaskId, setColorPickerTaskId] = useState<string | null>(null)
  const [priorityPickerTaskId, setPriorityPickerTaskId] = useState<string | null>(null)
  const [assigneeTaskId, setAssigneeTaskId] = useState<string | null>(null)
  const [progressTaskId, setProgressTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'purple' as string,
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    size: null as number | null,
  })

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formDataRef = useRef(formData)
  formDataRef.current = formData

  const showFilters = showFiltersFromParent ?? false
  const filters = filtersFromParent ?? internalFilters
  const setFilters = onFiltersChange ?? setInternalFilters

  const sortedColumns = useMemo(
    () => columns.filter((c) => c.projectId === projectId).sort((a, b) => a.orderIndex - b.orderIndex),
    [columns, projectId]
  )

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId), [tasks, projectId])
  const filteredTasks = useMemo(() => applyBoardFilters(projectTasks, filters), [projectTasks, filters])
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, typeof filteredTasks>()
    for (const task of filteredTasks) {
      const colId = task.columnId
      if (!colId) continue
      const arr = map.get(colId)
      if (arr) arr.push(task)
      else map.set(colId, [task])
    }
    for (const arr of map.values()) arr.sort((a, b) => a.orderIndex - b.orderIndex)
    return map
  }, [filteredTasks])
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

  const hasOpenOverlay = !!editingTask || !!newTaskColumnId || !!labelPickerTaskId || !!colorPickerTaskId || !!priorityPickerTaskId || !!dependencyTreeTaskId || !!assigneeTaskId || !!progressTaskId

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
    onToggleDone: (taskId) => cycleTaskCompletion(taskId, onTaskUpdate),
    onAddTask: handleAddTask,
    onCopyCard: handleCopyCard,
    onPasteCard: handlePasteCard,
    onSelectTask: selectTask,
    onOpenAssignee: (taskId) => setAssigneeTaskId((prev) => (prev === taskId ? null : taskId)),
    onOpenProgress: (taskId) => setProgressTaskId((prev) => (prev === taskId ? null : taskId)),
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

  const persistEdit = useCallback((data: typeof formData, taskId: string) => {
    const name = data.name.trim()
    if (!name) return
    const updates = {
      name,
      description: data.description.trim() || undefined,
      color: data.color,
      priority: data.priority,
      size: data.size,
    }
    updateTask(taskId, updates)
    onTaskUpdate?.(taskId, updates, { silent: true })
  }, [updateTask, onTaskUpdate])

  const flushAutosave = useCallback(() => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null }
    if (editingTask) persistEdit(formDataRef.current, editingTask)
  }, [editingTask, persistEdit])

  // Autosave title/description (Linear/Trello-style): debounce while typing and
  // flush on blur / close / unmount, so edits aren't lost when the modal is
  // dismissed without pressing the button.
  const handleFormChange = useCallback((data: typeof formData) => {
    setFormData(data)
    if (!editingTask) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    const taskId = editingTask
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null
      persistEdit(data, taskId)
    }, 700)
  }, [editingTask, persistEdit])

  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }, [])

  const handleSubmit = useCallback(() => {
    if (editingTask) {
      // Edits already autosaved; the button just flushes any pending write
      // and closes.
      flushAutosave()
      setEditingTask(null)
      return
    }
    if (!formData.name.trim()) return

    if (newTaskColumnId) {
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
  }, [formData, editingTask, newTaskColumnId, projectTasks, projectId, addTask, onTaskCreate, flushAutosave])

  const closeModal = useCallback(() => {
    flushAutosave()
    setEditingTask(null)
    setNewTaskColumnId(null)
  }, [flushAutosave])

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
          collisionDetection={boardCollisionDetection}
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
                      tasks={tasksByColumn.get(column.id) ?? EMPTY_TASKS}
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

          <DragOverlay dropAnimation={smoothUiRenders ? { duration: 300, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' } : { duration: 0 }}>
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
        onFormChange={handleFormChange}
        onSubmit={handleSubmit}
        onClose={closeModal}
        onBlurPersist={flushAutosave}
        onAddDependency={onAddDependency}
        onRemoveDependency={onRemoveDependency}
        onLabelToggle={onLabelToggle}
        onPushToGantt={onPushToGantt}
        onDateChange={(taskId, dates) => onTaskUpdate?.(taskId, dates as Record<string, unknown>)}
        onStatusChange={(taskId, status) => onTaskUpdate?.(taskId, { status })}
        onProgressChange={(taskId, progress) => onTaskUpdate?.(taskId, { progress }, { silent: true })}
        onTaskDelete={onTaskDelete}
      />

      <TaskAssigneeOverlay
        projectId={projectId}
        taskId={assigneeTaskId}
        onClose={() => setAssigneeTaskId(null)}
      />

      {progressTaskId && (
        <TaskProgressPopover
          taskId={progressTaskId}
          onClose={() => setProgressTaskId(null)}
          onTaskUpdate={onTaskUpdate}
        />
      )}

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
