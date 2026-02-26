'use client'

import { useCallback, useState, useEffect } from 'react'
import { DndContext, DragEndEvent, DragStartEvent, DragOverEvent, DragCancelEvent, DragOverlay, useSensor, useSensors, PointerSensor, useDroppable, closestCenter } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Trash2, Settings2, Sparkles, Zap, Ghost, Plus, FolderPlus } from 'lucide-react'
import { useBoardStore } from '@/lib/store/boardStore'
import { KanbanColumn } from './KanbanColumn'
import { AccentColor, colorConfig } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import { NeonButton } from '@/components/ui/NeonButton'
import { GlowCard } from '@/components/ui/GlowCard'
import { useThemeStore } from '@/stores/themeStore'
import { TaskChecklist } from './TaskChecklist'
import { getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem } from '@/lib/actions/checklist'

interface BoardTaskData {
  id: string
  projectId: string
  name: string
  description?: string
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
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string }[]) => void
}

type DragEffect = 'glow' | 'ghost' | 'lightning'

const COLUMNS = ['todo', 'doing', 'review', 'done'] as const
const ACCENT_COLORS: AccentColor[] = ['purple', 'blue', 'cyan', 'green', 'pink', 'orange']
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

export function TaskBoard({ projectId, onTaskCreate, onTaskUpdate, onTaskDelete, onTaskMove }: TaskBoardProps) {
  const { tasks, moveTask, addTask, updateTask, removeTask, selectTask, selectedTaskId } = useBoardStore()
  const { colors: themeColors, glowIntensity: globalGlow } = useThemeStore()
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskStatus, setNewTaskStatus] = useState<typeof COLUMNS[number] | null>(null)
  const [activeTask, setActiveTask] = useState<any>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [dragEffect, setDragEffect] = useState<DragEffect>('glow')
  const [showSettings, setShowSettings] = useState(false)
  const [sections, setSections] = useState<{ id: string; name: string; color: AccentColor }[]>([])
  const [addingSectionTo, setAddingSectionTo] = useState<string | null>(null)
  const [newSectionName, setNewSectionName] = useState('')
  const [checklistItemsState, setChecklistItemsState] = useState<
    { id: string; title: string; completed: boolean; startDate?: string; endDate?: string }[]
  >([])
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'purple' as AccentColor,
    priority: 'medium' as typeof PRIORITIES[number],
  })

  useEffect(() => {
    if (!editingTask) {
      setChecklistItemsState([])
      return
    }
    getChecklistItems(editingTask)
      .then((items) =>
        setChecklistItemsState(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            completed: i.completed,
            startDate: i.startDate ? i.startDate.toISOString() : undefined,
            endDate: i.endDate ? i.endDate.toISOString() : undefined,
          }))
        )
      )
      .catch(() => setChecklistItemsState([]))
  }, [editingTask])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const projectTasks = tasks.filter((t) => t.projectId === projectId)

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = projectTasks.find((t) => t.id === event.active.id)
    setActiveTask(task)
  }, [projectTasks])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) {
      setOverId(null)
      return
    }

    const activeId = active.id as string
    const currentOverId = over.id as string
    setOverId(currentOverId)

    const activeTask = projectTasks.find((t) => t.id === activeId)
    if (!activeTask) return

    const overTask = projectTasks.find((t) => t.id === currentOverId)
    const overColumn = over.data.current?.status || (COLUMNS.includes(currentOverId as any) ? currentOverId : null)

    if (overTask && activeTask.status !== overTask.status) {
      moveTask(activeId, overTask.status as typeof COLUMNS[number], overTask.orderIndex)
      onTaskMove?.([{ id: activeId, orderIndex: overTask.orderIndex, status: overTask.status }])
    } else if (overColumn && activeTask.status !== overColumn) {
      const tasksInColumn = projectTasks.filter((t) => t.status === overColumn)
      moveTask(activeId, overColumn as typeof COLUMNS[number], tasksInColumn.length)
      onTaskMove?.([{ id: activeId, orderIndex: tasksInColumn.length, status: overColumn }])
    }
  }, [projectTasks, moveTask, onTaskMove])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    setOverId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    if (overId === 'trash') {
      removeTask(activeId)
      onTaskDelete?.(activeId)
      return
    }

    const activeTask = projectTasks.find((t) => t.id === activeId)
    const overTask = projectTasks.find((t) => t.id === overId)

    if (activeTask && overTask && activeTask.status === overTask.status && activeId !== overId) {
      const columnTasks = projectTasks
        .filter((t) => t.status === activeTask.status)
        .sort((a, b) => a.orderIndex - b.orderIndex)

      const oldIndex = columnTasks.findIndex((t) => t.id === activeId)
      const newIndex = columnTasks.findIndex((t) => t.id === overId)

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
  }, [projectTasks, removeTask, updateTask, onTaskMove, onTaskDelete])

  const handleDragCancel = useCallback(() => {
    setActiveTask(null)
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
      setNewTaskStatus(null)
    }
  }, [tasks])

  const handleAddTask = useCallback((status: typeof COLUMNS[number]) => {
    setFormData({ name: '', description: '', color: 'purple', priority: 'medium' })
    setNewTaskStatus(status)
    setEditingTask(null)
  }, [])

  const handleAddSection = (columnStatus: string) => {
    if (!newSectionName.trim()) return
    setSections([...sections, { id: generateId(), name: newSectionName.trim(), color: 'purple' }])
    setNewSectionName('')
    setAddingSectionTo(null)
  }

  const handleChecklistAdd = useCallback((title: string) => {
    if (!editingTask) return
    const newItem = {
      id: generateId(),
      taskId: editingTask,
      title,
      orderIndex: checklistItemsState.length,
    }
    setChecklistItemsState((prev) => [...prev, { id: newItem.id, title, completed: false }])
    createChecklistItem(newItem).catch(() => {})
  }, [editingTask, checklistItemsState.length])

  const handleChecklistToggle = useCallback((itemId: string) => {
    if (!editingTask) return
    setChecklistItemsState((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, completed: !i.completed } : i))
    )
    const item = checklistItemsState.find((i) => i.id === itemId)
    if (item) {
      updateChecklistItem(itemId, editingTask, { completed: !item.completed }).catch(() => {})
    }
  }, [editingTask, checklistItemsState])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTask) return
    setChecklistItemsState((prev) => prev.filter((i) => i.id !== itemId))
    deleteChecklistItem(itemId, editingTask).catch(() => {})
  }, [editingTask])

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
    } else if (newTaskStatus) {
      const maxOrder = Math.max(0, ...projectTasks.filter((t) => t.status === newTaskStatus).map((t) => t.orderIndex))
      const newTask = {
        id: generateId(),
        projectId,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        status: newTaskStatus,
        priority: formData.priority,
        color: formData.color,
        labels: [],
        onTimeline: false,
        orderIndex: maxOrder + 1,
      }
      addTask(newTask)
      onTaskCreate?.(newTask)
      setNewTaskStatus(null)
    }
  }, [formData, editingTask, newTaskStatus, projectTasks, projectId, updateTask, addTask, onTaskCreate, onTaskUpdate])

  const closeModal = () => {
    setEditingTask(null)
    setNewTaskStatus(null)
  }

  const isModalOpen = editingTask !== null || newTaskStatus !== null
  const isDragging = activeTask !== null
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex gap-4 overflow-x-auto pb-4 h-full">
            {COLUMNS.map((status) => (
              <div key={status} className="flex flex-col gap-2 min-w-[300px]">
                <KanbanColumn
                  status={status}
                  projectId={projectId}
                  tasks={projectTasks
                    .filter((t) => t.status === status)
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((t) => ({
                      ...t,
                      color: t.color as AccentColor,
                    }))}
                  onTaskEdit={handleTaskEdit}
                  onAddTask={() => handleAddTask(status)}
                  onTaskCreate={onTaskCreate}
                  overId={overId}
                  activeTaskId={activeTask?.id}
                />

                {addingSectionTo === status ? (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-white/5 backdrop-blur-xl border border-white/10"
                  >
                    <input
                      type="text"
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddSection(status)
                        if (e.key === 'Escape') setAddingSectionTo(null)
                      }}
                      placeholder="Section name..."
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleAddSection(status)}
                        className="flex-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setAddingSectionTo(null)}
                        className="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-white/10"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <button
                    onClick={() => setAddingSectionTo(status)}
                    className="flex items-center justify-center gap-2 p-2 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-200 border border-dashed border-white/10 hover:border-white/20"
                  >
                    <FolderPlus className="w-4 h-4" />
                    Add Section
                  </button>
                )}
              </div>
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 300, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeTask && <DragPreview task={activeTask} effect={dragEffect} globalGlow={globalGlow} />}
          </DragOverlay>

          <TrashDropZone isActive={isDragging} />
        </DndContext>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full max-w-md p-6 rounded-xl',
                'bg-gradient-to-b from-white/10 to-black/40',
                'backdrop-blur-xl border border-white/10',
                'shadow-[0_0_40px_rgba(99,102,241,0.3)]'
              )}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">
                  {editingTask ? 'Edit Task' : 'New Task'}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Task name..."
                    className={cn(
                      'w-full px-4 py-2.5 rounded-lg',
                      'bg-white/5 border border-white/10',
                      'text-white placeholder-slate-500',
                      'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                      'transition-all duration-200'
                    )}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Optional description..."
                    rows={3}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-lg resize-none',
                      'bg-white/5 border border-white/10',
                      'text-white placeholder-slate-500',
                      'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                      'transition-all duration-200'
                    )}
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Color</label>
                  <div className="flex gap-2">
                    {ACCENT_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setFormData({ ...formData, color })}
                        className={cn(
                          'w-8 h-8 rounded-lg transition-all duration-200',
                          colorConfig[color].bgSolid,
                          formData.color === color && 'ring-2 ring-offset-2 ring-offset-black ring-white scale-110'
                        )}
                        style={{ boxShadow: formData.color === color ? `0 0 15px ${colorConfig[color].glow}` : undefined }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Priority</label>
                  <div className="flex gap-2">
                    {PRIORITIES.map((priority) => (
                      <button
                        key={priority}
                        onClick={() => setFormData({ ...formData, priority })}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all duration-200',
                          'border',
                          formData.priority === priority
                            ? 'bg-white/10 border-white/30 text-white'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                        )}
                      >
                        {priority}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {editingTask && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <TaskChecklist
                    taskId={editingTask}
                    items={checklistItemsState}
                    onItemAdd={handleChecklistAdd}
                    onItemToggle={handleChecklistToggle}
                    onItemRemove={handleChecklistRemove}
                  />
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <NeonButton
                  onClick={handleSubmit}
                  disabled={!formData.name.trim()}
                  className="flex-1"
                  color={formData.color}
                >
                  {editingTask ? 'Save Changes' : 'Create Task'}
                </NeonButton>
                <button
                  onClick={closeModal}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium',
                    'bg-white/5 hover:bg-white/10 border border-white/10',
                    'text-slate-400 hover:text-white',
                    'transition-all duration-200'
                  )}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
