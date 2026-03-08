'use client'

import { useCallback, useState, useMemo } from 'react'
import { DndContext, DragEndEvent, DragStartEvent, DragOverEvent, DragOverlay, useSensor, useSensors, PointerSensor, useDroppable, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, Settings2, Sparkles, Zap, Ghost, Filter, Plus } from 'lucide-react'
import { useBoardStore, type BoardColumn } from '@/lib/store/boardStore'
import { KanbanColumn } from './KanbanColumn'
import { SortableColumn } from './SortableColumn'
import { TaskEditModal } from './TaskEditModal'
import { BoardFilterBar } from './BoardFilterBar'
import { DependencyGlowTree } from './DependencyGlowTree'
import { AccentColor, colorConfig } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import { GlowCard } from '@/components/ui/GlowCard'
import { useThemeStore } from '@/stores/themeStore'
import { applyBoardFilters, activeFilterCount, DEFAULT_FILTERS } from '@/lib/utils/boardFilters'
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
  onTaskCreate?: (task: BoardTaskData) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>) => void
  onTaskDelete?: (taskId: string) => void
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string }[]) => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onColumnCreate?: (column: { id: string; projectId: string; name: string; color: string; orderIndex: number }) => void
  onColumnUpdate?: (columnId: string, updates: Partial<BoardColumn>) => void
  onColumnReorder?: (updates: { id: string; orderIndex: number }[]) => void
}

type DragEffect = 'glow' | 'ghost' | 'lightning'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const DRAG_EFFECTS: { id: DragEffect; name: string; icon: typeof Sparkles }[] = [
  { id: 'glow', name: 'Aurora Glow', icon: Sparkles },
  { id: 'ghost', name: 'Ghost Trail', icon: Ghost },
  { id: 'lightning', name: 'Lightning', icon: Zap },
]

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function TrashDropZone({ isActive }: { isActive: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash', data: { type: 'trash' } })

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          ref={setNodeRef}
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
          className={cn(
            'fixed bottom-8 left-1/2 -translate-x-1/2 z-50',
            'px-8 py-4 rounded-2xl',
            'backdrop-blur-xl border-2 border-dashed',
            'flex items-center gap-3 transition-all duration-300',
            isOver
              ? 'bg-red-500/30 border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.5)]'
              : 'bg-white/5 border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.1)]'
          )}
        >
          <Trash2 className={cn('w-6 h-6 transition-colors', isOver ? 'text-red-400' : 'text-slate-400')} />
          <span className={cn('font-medium transition-colors', isOver ? 'text-red-400' : 'text-slate-400')}>
            {isOver ? 'Release to delete' : 'Drop here to delete'}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DragPreview({ task, effect, globalGlow }: { task: any; effect: DragEffect; globalGlow: number }) {
  const colors = colorConfig[task.color as AccentColor]
  const mult = globalGlow / 75

  const effectStyles = {
    glow: {
      boxShadow: `0 0 ${60 * mult}px ${20 * mult}px ${colors.glow}, 0 0 ${100 * mult}px ${40 * mult}px ${colors.glowDark}`,
      transform: 'scale(1.05) rotate(2deg)',
    },
    ghost: {
      opacity: 0.8,
      boxShadow: `0 20px 40px rgba(0,0,0,0.5)`,
      transform: 'scale(1.02)',
      filter: 'blur(0.5px)',
    },
    lightning: {
      boxShadow: `0 0 ${30 * mult}px ${10 * mult}px ${colors.glow}, inset 0 0 ${20 * mult}px ${colors.glowDark}`,
      transform: 'scale(1.08)',
      animation: 'pulse 0.3s ease-in-out infinite alternate',
    },
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      className="pointer-events-none"
      style={effectStyles[effect]}
    >
      <GlowCard accentColor={task.color} glowIntensity="xl" showAccentLine className="p-3 w-72">
        <h4 className="text-sm font-medium text-white line-clamp-2">{task.name}</h4>
        {task.description && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{task.description}</p>}
      </GlowCard>
    </motion.div>
  )
}

export function TaskBoard({
  projectId,
  onTaskCreate,
  onTaskUpdate,
  onTaskDelete,
  onTaskMove,
  onAddDependency,
  onRemoveDependency,
  onColumnCreate,
  onColumnUpdate,
  onColumnReorder,
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
    reorderColumns,
  } = useBoardStore()
  const { colors: themeColors, glowIntensity: globalGlow } = useThemeStore()
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [activeItem, setActiveItem] = useState<{ type: 'task' | 'column'; data: any } | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dragEffect, setDragEffect] = useState<DragEffect>('glow')
  const [showSettings, setShowSettings] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<BoardFilters>(DEFAULT_FILTERS)
  const [dependencyTreeTaskId, setDependencyTreeTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'purple' as AccentColor,
    priority: 'medium' as typeof PRIORITIES[number],
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const sortedColumns = useMemo(
    () => columns.filter((c) => c.projectId === projectId).sort((a, b) => a.orderIndex - b.orderIndex),
    [columns, projectId]
  )

  const projectTasks = tasks.filter((t) => t.projectId === projectId)
  const filteredTasks = useMemo(() => applyBoardFilters(projectTasks, filters), [projectTasks, filters])
  const filterCount = activeFilterCount(filters)
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
    const task = tasks.find((t) => t.id === taskId)
    if (task) {
      setFormData({
        name: task.name,
        description: task.description || '',
        color: task.color as AccentColor,
        priority: task.priority,
      })
      setEditingTask(taskId)
      setNewTaskColumnId(null)
    }
  }, [tasks])

  const handleAddTask = useCallback((columnId: string) => {
    setFormData({ name: '', description: '', color: 'purple', priority: 'medium' })
    setNewTaskColumnId(columnId)
    setEditingTask(null)
  }, [])

  const handleColumnRename = useCallback((columnId: string, name: string) => {
    updateColumn(columnId, { name })
    onColumnUpdate?.(columnId, { name })
  }, [updateColumn, onColumnUpdate])

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
  const isDragging = activeItem !== null
  const isTaskDrag = activeItem?.type === 'task'
  const glowMult = globalGlow / 75

  const bgOpacity1 = Math.round(8 * glowMult).toString(16).padStart(2, '0')
  const bgOpacity2 = Math.round(5 * glowMult).toString(16).padStart(2, '0')
  const bgOpacity3 = Math.round(21 * glowMult).toString(16).padStart(2, '0')
  const bgOpacity4 = Math.round(16 * glowMult).toString(16).padStart(2, '0')

  return (
    <>
      <div
        className="absolute inset-0 -z-10 rounded-3xl overflow-hidden"
        style={{
          background: globalGlow > 0 ? `linear-gradient(135deg, ${themeColors.glowColor}${bgOpacity1} 0%, transparent 50%, ${themeColors.glowColor}${bgOpacity2} 100%)` : 'transparent',
        }}
      >
        {globalGlow > 0 && (
          <>
            <div
              className="absolute inset-0 backdrop-blur-3xl"
              style={{
                background: `radial-gradient(ellipse at top left, ${themeColors.glowColor}${bgOpacity3} 0%, transparent 50%)`,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse at bottom right, ${themeColors.glowColor}${bgOpacity4} 0%, transparent 50%)`,
              }}
            />
          </>
        )}
      </div>

      <div className="relative">
        <div className="flex items-center justify-end gap-2 mb-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'relative p-2 rounded-lg transition-all duration-200',
              'hover:bg-white/10 text-slate-400 hover:text-white',
              showFilters && 'bg-white/10 text-white'
            )}
          >
            <Filter className="w-5 h-5" />
            {filterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
                {filterCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              'p-2 rounded-lg transition-all duration-200',
              'hover:bg-white/10 text-slate-400 hover:text-white',
              showSettings && 'bg-white/10 text-white'
            )}
          >
            <Settings2 className="w-5 h-5" />
          </button>
        </div>

        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden"
            >
              <div className="p-4 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10">
                <h3 className="text-sm font-medium text-white mb-3">Drag Effect</h3>
                <div className="flex gap-2">
                  {DRAG_EFFECTS.map(({ id, name, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setDragEffect(id)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                        'border',
                        dragEffect === id
                          ? 'bg-purple-500/20 border-purple-500/50 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-4 overflow-x-auto pb-4 h-full">
              {sortedColumns.map((column) => (
                <SortableColumn key={column.id} column={column}>
                  {(dragHandleProps) => (
                    <KanbanColumn
                      column={column}
                      projectId={projectId}
                      tasks={filteredTasks
                        .filter((t) => t.columnId === column.id)
                        .sort((a, b) => a.orderIndex - b.orderIndex)
                        .map((t) => ({
                          ...t,
                          color: t.color as AccentColor,
                        }))}
                      onTaskEdit={handleTaskEdit}
                      onAddTask={() => handleAddTask(column.id)}
                      onTaskCreate={onTaskCreate}
                      onColumnRename={handleColumnRename}
                      overId={overId}
                      activeTaskId={activeItem?.type === 'task' ? activeItem.data?.id : null}
                      onDependencyClick={setDependencyTreeTaskId}
                      dragHandleProps={dragHandleProps}
                    />
                  )}
                </SortableColumn>
              ))}

              <motion.button
                onClick={handleAddColumn}
                className={cn(
                  'flex-shrink-0 flex flex-col items-center justify-center',
                  'min-w-[200px] h-32 rounded-xl',
                  'border-2 border-dashed border-white/10 hover:border-white/25',
                  'text-slate-500 hover:text-slate-300',
                  'transition-all duration-200',
                  'hover:bg-white/[0.03]'
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Plus className="w-6 h-6 mb-2" />
                <span className="text-sm font-medium">Add Column</span>
              </motion.button>
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
    </>
  )
}
