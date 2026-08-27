'use client'

import { useCallback, useState, useMemo, useEffect } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useBoardStore, useColumns, useTasks, useSelectedTaskId, type BoardColumn, type BoardTask, type TaskAssigneePill } from '@/lib/store/boardStore'
import { cn } from '@/lib/utils/cn'
import { MissionEditorModal } from './MissionEditorModal'
import { KanbanColumn } from './KanbanColumn'
import { SortableColumn } from './SortableColumn'
import { TaskEditModal } from './TaskEditModal'
import { FloatingCardsLayer } from './FloatingCardsLayer'
import { ZenModeLayer } from './ZenModeLayer'
import { BoardFilterBar } from './BoardFilterBar'
import { BoardOverlays } from './BoardOverlays'
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
import { useBoardOverlays, type BoardTaskData } from './useBoardOverlays'
import { useBoardPinchZoom } from './useBoardPinchZoom'
import { boardCollisionDetection } from './boardCollision'
import { useBoardKeyboardShortcuts } from './useBoardKeyboardShortcuts'
import { useBoardHover } from './useBoardHover'
import { cycleTaskCompletion } from './triState'
import { useConnectMode } from './useConnectMode'
import { duplicateBoardTask } from '@/lib/actions/board'
import { prefetchAssignablePeople } from '@/lib/store/membersCache'
import { toast } from '@/components/ui/Toast'

const EMPTY_TASKS: BoardTask[] = []

// Stable empty map so the assignee selector returns a referentially-identical
// value while no assignee filter is active (see filteredTasks below).
const EMPTY_ASSIGNEES: Record<string, TaskAssigneePill[]> = {}

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
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
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
  const selectTask = useBoardStore((s) => s.selectTask)
  const addColumn = useBoardStore((s) => s.addColumn)
  const updateColumn = useBoardStore((s) => s.updateColumn)
  const removeColumn = useBoardStore((s) => s.removeColumn)
  const { colors: themeColors, glowIntensity: globalGlow, dragEffect, shortcuts, boardLayout, smoothUiRenders } = useThemeStore()

  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null)
  const [internalFilters, setInternalFilters] = useState<BoardFilters>(DEFAULT_FILTERS)

  const showFilters = showFiltersFromParent ?? false
  const filters = filtersFromParent ?? internalFilters
  const setFilters = onFiltersChange ?? setInternalFilters

  const sortedColumns = useMemo(
    () => columns.filter((c) => c.projectId === projectId).sort((a, b) => a.orderIndex - b.orderIndex),
    [columns, projectId]
  )

  // Warm the assignable-people cache so the assignee overlay opens instantly.
  useEffect(() => {
    prefetchAssignablePeople(projectId)
  }, [projectId])

  // Subscribe to assignee data only while an assignee filter is active —
  // otherwise every optimistic assignment would re-render the whole board.
  const assigneeFilterActive = (filters.assignees?.size ?? 0) > 0
  const assigneesByTask = useBoardStore((s) => (assigneeFilterActive ? s.assigneesByTask : EMPTY_ASSIGNEES))
  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId), [tasks, projectId])
  const filteredTasks = useMemo(() => {
    // Assignee data lives outside the task rows — enrich only when the
    // assignee filter is active so the common path allocates nothing extra.
    const source = filters.assignees?.size
      ? projectTasks.map((t) => ({ ...t, assigneeIds: (assigneesByTask[t.id] ?? []).map((a) => a.userId) }))
      : projectTasks
    return applyBoardFilters(source, filters)
  }, [projectTasks, filters, assigneesByTask])
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
  const { containerRef: pinchContainerRef, contentRef: pinchContentRef } = useBoardPinchZoom()

  const { connectSourceId, cursorPos, handleConnectClick, cancelConnect } = useConnectMode({
    connectMode,
    onAddDependency,
    onConnectModeChange,
  })

  // Auto AI launches ride on the move mutation (see useBoardHandlers): the
  // agent is spawned only once the card's move is durable.
  const { sensors, activeItem, overId, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel } = useBoardDnD({
    projectTasks,
    sortedColumns,
    onTaskMove,
    onTaskDelete,
    onColumnReorder,
  })

  const {
    editingTask,
    newTaskColumnId,
    formData,
    isModalOpen,
    hasOpenOverlay,
    zenColumnId,
    zenColumn,
    overlayState,
    handleAddTask,
    handleTaskEdit,
    handleFormChange,
    handleSubmit,
    closeModal,
    flushAutosave,
    handlePinCard,
    handleUnpinCard,
  } = useBoardOverlays({ projectId, projectTasks, sortedColumns, onTaskCreate, onTaskUpdate })

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

  useBoardKeyboardShortcuts({
    hoveredTaskId,
    selectedTaskId,
    shortcuts,
    sortedColumns,
    hasOpenOverlay,
    onOpenLabel: overlayState.setLabelPickerTaskId,
    onOpenColorPicker: overlayState.setColorPickerTaskId,
    onOpenPriorityPicker: overlayState.setPriorityPickerTaskId,
    onEditCard: handleTaskEdit,
    onToggleDone: (taskId) => cycleTaskCompletion(taskId, onTaskUpdate),
    onAddTask: handleAddTask,
    onCopyCard: handleCopyCard,
    onPasteCard: handlePasteCard,
    onSelectTask: selectTask,
    onOpenAssignee: (taskId) => overlayState.setAssigneeTaskId((prev) => (prev === taskId ? null : taskId)),
    onOpenProgress: (taskId) => overlayState.setProgressTaskId((prev) => (prev === taskId ? null : taskId)),
    onOpenSize: (taskId) => overlayState.setSizeTaskId((prev) => (prev === taskId ? null : taskId)),
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
            {/*
              Two-layer board surface:
              - outer div = the scroll container. `touch-action: pan-x pan-y`
                allows one-finger panning but forbids NATIVE pinch-zoom for any
                touch starting on the board (touch-action of ancestors
                constrains descendants), so pinch never escapes the app canvas.
                useBoardPinchZoom then implements the contained bird's-eye
                pinch on this element. overscroll-x-contain stops horizontal
                edge-swipes from triggering browser back/forward navigation.
              - inner div = the scaled columns wrapper the pinch transform is
                applied to. DragOverlay stays OUTSIDE it: dnd-kit overlays
                inside transformed ancestors drift (clauderic/dnd-kit#464).
            */}
            <div
              ref={pinchContainerRef}
              data-board-columns
              // --board-chrome (default 120px) matches the host page's board
              // wrapper (ProjectContent / demo override); column caps
              // subtract a further 24px for the scale wrapper's pb-4 +
              // horizontal scrollbar, so a capped board fits this box — no
              // phantom scrollbar, no dead band under the columns. The min-h
              // floor lifts while the filter bar is open: it shares the fixed
              // wrapper, and floor + bar would push the board's bottom edge
              // below the fold.
              className={cn(
                boardLayout === 'grid'
                  ? 'overflow-x-hidden overflow-y-auto sm:overflow-auto sm:max-h-[calc(100dvh-var(--board-chrome,120px))] overscroll-x-contain'
                  : 'overflow-x-auto overflow-y-hidden sm:overflow-auto sm:max-h-[calc(100dvh-var(--board-chrome,120px))] overscroll-x-contain',
                !showFilters && 'min-h-[calc(100dvh-var(--board-chrome,120px))]'
              )}
              style={{ touchAction: 'pan-x pan-y' }}
            >
              <div
                ref={pinchContentRef}
                data-board-scale
                data-board-layout={boardLayout}
                className={boardLayout === 'grid'
                  ? 'flex flex-wrap gap-3 sm:gap-4 pb-4 content-start'
                  : 'flex flex-nowrap gap-3 sm:gap-4 pb-4 w-max min-w-full'
                }
                style={activeItem ? { willChange: 'transform' } : undefined}
              >
              {sortedColumns.map((column) => (
                <SortableColumn key={column.id} column={column} zenHidden={zenColumnId === column.id}>
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
                      onDependencyClick={overlayState.setDependencyTreeTaskId}
                      dragHandleProps={dragHandleProps}
                    />
                  )}
                </SortableColumn>
              ))}

                <AddColumnButton onClick={handleAddColumn} />
              </div>
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
        onLabelCreate={onLabelCreate}
        onLabelUpdate={onLabelUpdate}
        onLabelDelete={onLabelDelete}
        onLabelToggle={onLabelToggle}
        onPushToGantt={onPushToGantt}
        onDateChange={(taskId, dates) => onTaskUpdate?.(taskId, dates as Record<string, unknown>)}
        onStatusChange={(taskId, status) => onTaskUpdate?.(taskId, { status })}
        onProgressChange={(taskId, progress) => onTaskUpdate?.(taskId, { progress }, { silent: true })}
        onTaskDelete={onTaskDelete}
        onPin={handlePinCard}
      />

      <MissionEditorModal projectId={projectId} />

      {zenColumn && (
        <ZenModeLayer
          column={zenColumn}
          projectId={projectId}
          tasks={tasksByColumn.get(zenColumn.id) ?? EMPTY_TASKS}
          escapeDisabled={hasOpenOverlay}
          onTaskEdit={handleTaskClick}
          onTaskCreate={onTaskCreate}
          onTaskUpdate={onTaskUpdate}
          onTaskDelete={onTaskDelete}
          onPushToGantt={onPushToGantt}
          onSendToVault={onSendToVault}
          onArchiveTask={onArchiveTask}
          onDependencyClick={overlayState.setDependencyTreeTaskId}
          onTaskMove={onTaskMove}
        />
      )}

      <FloatingCardsLayer
        projectId={projectId}
        onUnpin={handleUnpinCard}
        onTaskUpdate={onTaskUpdate}
        onTaskDelete={onTaskDelete}
        onAddDependency={onAddDependency}
        onRemoveDependency={onRemoveDependency}
        onLabelCreate={onLabelCreate}
        onLabelUpdate={onLabelUpdate}
        onLabelDelete={onLabelDelete}
        onLabelToggle={onLabelToggle}
        onPushToGantt={onPushToGantt}
      />

      <BoardOverlays
        projectId={projectId}
        state={overlayState}
        showAllDeps={showAllDeps}
        onShowAllDepsChange={onShowAllDepsChange}
        onTaskEdit={handleTaskEdit}
        onTaskUpdate={onTaskUpdate}
        onLabelCreate={onLabelCreate}
        onLabelUpdate={onLabelUpdate}
        onLabelDelete={onLabelDelete}
        onLabelToggle={onLabelToggle}
      />

      <ConnectModeBanner
        connectMode={connectMode ?? false}
        connectSourceId={connectSourceId}
        cursorPos={cursorPos}
        onCancel={cancelConnect}
      />
    </>
  )
}
