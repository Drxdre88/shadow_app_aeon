'use client'

import { useCallback, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronDown, Palette, Tag, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, colorConfig, generateId, hexToRgba } from '@/lib/utils/colors'
import { NeonButton } from '@/components/ui/NeonButton'
import { TaskChecklist, type ChecklistItem, type CheckState, type ChecklistStatus } from './TaskChecklist'
import { TaskDependencySection } from './TaskDependencySection'
import { getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem } from '@/lib/actions/checklist'
import { ColorSwatchPicker } from './ColorSwatchPicker'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

interface FormData {
  name: string
  description: string
  color: string
  priority: typeof PRIORITIES[number]
  size: number | null
}

interface TaskEditModalProps {
  isOpen: boolean
  editingTaskId: string | null
  newTaskStatus: string | null
  formData: FormData
  projectId: string
  onFormChange: (data: FormData) => void
  onSubmit: () => void
  onClose: () => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  onPushToGantt?: (taskId: string) => void
  onDateChange?: (taskId: string, dates: { startDate?: string | null; endDate?: string | null }) => void
}

const resolveNeonColor = (color: string): AccentColor =>
  ACCENT_COLORS.includes(color as AccentColor) ? (color as AccentColor) : 'purple'

export function TaskEditModal({
  isOpen,
  editingTaskId,
  newTaskStatus,
  formData,
  projectId,
  onFormChange,
  onSubmit,
  onClose,
  onAddDependency,
  onRemoveDependency,
  onLabelToggle,
  onPushToGantt,
  onDateChange,
}: TaskEditModalProps) {
  const { labels, tasks, updateTask } = useBoardStore()
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (formData.name.trim()) onSubmit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onSubmit, formData.name])

  useEffect(() => {
    if (!editingTaskId) {
      setChecklistItems([])
      return
    }
    getChecklistItems(editingTaskId, projectId)
      .then((items) =>
        setChecklistItems(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            completed: i.completed,
            state: (i.state as CheckState) ?? (i.completed ? 'checked' : 'unchecked'),
            status: (i.status as ChecklistStatus) ?? null,
            groupName: i.groupName ?? 'Checklist',
            startDate: i.startDate ? i.startDate.toISOString() : undefined,
            endDate: i.endDate ? i.endDate.toISOString() : undefined,
          }))
        )
      )
      .catch(() => setChecklistItems([]))
  }, [editingTaskId, projectId])

  const handleChecklistAdd = useCallback((title: string, groupName: string) => {
    if (!editingTaskId) return
    const groupItems = checklistItems.filter((i) => i.groupName === groupName)
    const newItem: ChecklistItem = {
      id: generateId(),
      title,
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    setChecklistItems((prev) => [...prev, newItem])
    createChecklistItem({
      id: newItem.id,
      taskId: editingTaskId,
      projectId,
      title,
      orderIndex: groupItems.length,
      groupName,
    }).catch(() => {})
  }, [editingTaskId, checklistItems, projectId])

  const handleChecklistToggle = useCallback((itemId: string, newState: CheckState) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, state: newState, completed: newState === 'checked' } : i))
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { state: newState }).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistStatusChange = useCallback((itemId: string, status: ChecklistStatus) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status } : i))
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { status }).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTaskId) return
    setChecklistItems((prev) => prev.filter((i) => i.id !== itemId))
    deleteChecklistItem(itemId, editingTaskId, projectId).catch(() => {})
  }, [editingTaskId, projectId])

  const handleGroupAdd = useCallback((groupName: string) => {
    if (!editingTaskId) return
    const placeholder: ChecklistItem = {
      id: generateId(),
      title: 'New item',
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    setChecklistItems((prev) => [...prev, placeholder])
    createChecklistItem({
      id: placeholder.id,
      taskId: editingTaskId,
      projectId,
      title: placeholder.title,
      orderIndex: 0,
      groupName,
    }).catch(() => {})
  }, [editingTaskId, projectId])

  const currentColorHex = formData.color.startsWith('#')
    ? formData.color
    : colorConfig[formData.color as AccentColor]?.hex ?? '#a855f7'

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-xl border border-white/10',
              'shadow-[0_0_40px_rgba(99,102,241,0.3)]'
            )}
          >
            <div className="flex items-center justify-between p-6 pb-0 flex-shrink-0">
              <h2 className="text-lg font-semibold text-white">
                {editingTaskId ? 'Edit Task' : 'New Task'}
              </h2>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
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
                  onChange={(e) => {
                    onFormChange({ ...formData, description: e.target.value })
                    const el = e.target
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
                  }}
                  placeholder="Optional description..."
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg resize-none',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
                    'transition-all duration-200'
                  )}
                  onFocus={(e) => {
                    const el = e.target
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setColorPickerOpen(!colorPickerOpen)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-lg',
                      'bg-white/5 border border-white/10 hover:bg-white/10',
                      'text-slate-400 hover:text-white transition-all'
                    )}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-white/20"
                      style={{
                        backgroundColor: currentColorHex,
                        boxShadow: `0 0 8px ${currentColorHex}60`,
                      }}
                    />
                    <Palette className="w-3.5 h-3.5" />
                    <ChevronDown className={cn('w-3 h-3 transition-transform', colorPickerOpen && 'rotate-180')} />
                  </button>

                  <ColorSwatchPicker
                    value={formData.color}
                    onChange={(color) => onFormChange({ ...formData, color })}
                    isOpen={colorPickerOpen}
                    onClose={() => setColorPickerOpen(false)}
                    swatchShape="square"
                    animated
                  />
                </div>

                <div className="flex gap-1.5 flex-1">
                  {PRIORITIES.map((priority) => (
                    <button
                      key={priority}
                      onClick={() => onFormChange({ ...formData, priority })}
                      className={cn(
                        'flex-1 px-2 py-1.5 rounded-lg text-xs font-medium capitalize transition-all duration-200',
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

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Size (days)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={formData.size ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? parseFloat(e.target.value) : null
                      onFormChange({ ...formData, size: val })
                    }}
                    placeholder="Auto"
                    step={0.5}
                    min={0.5}
                    max={20}
                    className={cn(
                      'w-24 px-3 py-2 rounded-lg',
                      'bg-white/5 border border-white/10',
                      'text-white placeholder-slate-500 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
                      'transition-all duration-200'
                    )}
                  />
                  <span className="text-xs text-slate-500">
                    {formData.size
                      ? `${formData.size} day${formData.size !== 1 ? 's' : ''}`
                      : 'Auto (2d)'
                    }
                  </span>
                </div>
              </div>

              {editingTaskId && (() => {
                const task = tasks.find((t) => t.id === editingTaskId)
                const startIso = task?.startDate ? new Date(task.startDate).toISOString().slice(0, 10) : ''
                const endIso = task?.endDate ? new Date(task.endDate).toISOString().slice(0, 10) : ''
                return (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">Dates</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={startIso}
                        onChange={(e) => {
                          const val = e.target.value
                          const start = val ? new Date(val + 'T00:00:00').toISOString() : null
                          updateTask(editingTaskId, { startDate: start ?? undefined })
                          onDateChange?.(editingTaskId, { startDate: start })
                          if (start && !endIso) {
                            updateTask(editingTaskId, { endDate: start })
                            onDateChange?.(editingTaskId, { endDate: start })
                          }
                        }}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm',
                          'bg-white/5 border border-white/10',
                          'text-white',
                          'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
                          'transition-all duration-200',
                          '[color-scheme:dark]'
                        )}
                      />
                      <span className="text-slate-500 text-xs">to</span>
                      <input
                        type="date"
                        value={endIso}
                        onChange={(e) => {
                          const val = e.target.value
                          const end = val ? new Date(val + 'T00:00:00').toISOString() : null
                          updateTask(editingTaskId, { endDate: end ?? undefined })
                          onDateChange?.(editingTaskId, { endDate: end })
                          if (end && !startIso) {
                            updateTask(editingTaskId, { startDate: end })
                            onDateChange?.(editingTaskId, { startDate: end })
                          }
                        }}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm',
                          'bg-white/5 border border-white/10',
                          'text-white',
                          'focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
                          'transition-all duration-200',
                          '[color-scheme:dark]'
                        )}
                      />
                      {(startIso || endIso) && (
                        <button
                          onClick={() => {
                            updateTask(editingTaskId, { startDate: undefined, endDate: undefined })
                            onDateChange?.(editingTaskId, { startDate: null, endDate: null })
                          }}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors"
                          title="Clear dates"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {startIso && endIso && (() => {
                      const s = new Date(startIso)
                      const e = new Date(endIso)
                      const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)))
                      const sameDay = s.toDateString() === e.toDateString()
                      return (
                        <p className="text-xs text-slate-500 mt-1">
                          {sameDay ? '1 day' : `${days} days`}
                        </p>
                      )
                    })()}
                  </div>
                )
              })()}

              {editingTaskId && labels.length > 0 && (() => {
                const task = tasks.find((t) => t.id === editingTaskId)
                const taskLabels = task?.labels ?? []
                const projectLabels = labels.filter((l) => l.projectId === projectId)
                if (projectLabels.length === 0) return null

                const handleToggle = (labelId: string) => {
                  const hasLabel = taskLabels.includes(labelId)
                  const newLabels = hasLabel
                    ? taskLabels.filter((id) => id !== labelId)
                    : [...taskLabels, labelId]
                  updateTask(editingTaskId, { labels: newLabels })
                  onLabelToggle?.(editingTaskId, labelId, hasLabel ? 'remove' : 'add')
                }

                return (
                  <div className="pt-4 border-t border-white/10">
                    <label className="block text-sm text-slate-400 mb-2">Labels</label>
                    <div className="flex flex-wrap gap-1.5">
                      {projectLabels.map((label) => {
                        const lc = colorConfig[label.color as AccentColor]
                        const isCustom = !lc
                        const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
                        const isActive = taskLabels.includes(label.id)
                        return (
                          <button
                            key={label.id}
                            type="button"
                            onClick={() => handleToggle(label.id)}
                            className={cn(
                              'px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5',
                              'border transition-all duration-200',
                              isActive
                                ? cn(!isCustom && lc?.bg, !isCustom && lc?.border, !isCustom && lc?.text, 'ring-1 ring-white/30', isCustom && 'text-white')
                                : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-400 hover:border-white/20'
                            )}
                            style={isActive && isCustom ? {
                              backgroundColor: hexToRgba(hex, 0.15),
                              borderColor: hexToRgba(hex, 0.3),
                              color: hex,
                            } : undefined}
                          >
                            <Tag className="w-3 h-3" />
                            {label.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {editingTaskId && (
                <>
                  <div className="pt-4 border-t border-white/10">
                    <TaskChecklist
                      taskId={editingTaskId}
                      items={checklistItems}
                      onItemAdd={handleChecklistAdd}
                      onItemToggle={handleChecklistToggle}
                      onItemRemove={handleChecklistRemove}
                      onItemStatusChange={handleChecklistStatusChange}
                      onGroupAdd={handleGroupAdd}
                    />
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    <TaskDependencySection
                      taskId={editingTaskId}
                      projectId={projectId}
                      onAddDependency={onAddDependency}
                      onRemoveDependency={onRemoveDependency}
                    />
                  </div>

                  {!tasks.find((t) => t.id === editingTaskId)?.onTimeline && onPushToGantt && (
                    <div className="pt-4 border-t border-white/10">
                      <button
                        onClick={() => onPushToGantt(editingTaskId)}
                        className={cn(
                          'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
                          'bg-cyan-500/10 border border-cyan-500/20',
                          'text-cyan-400 text-sm font-medium',
                          'hover:bg-cyan-500/20 transition-all duration-200'
                        )}
                      >
                        <Calendar className="w-4 h-4" />
                        Push to Gantt
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-3 p-6 pt-4 flex-shrink-0 border-t border-white/10">
              <NeonButton
                onClick={onSubmit}
                disabled={!formData.name.trim()}
                className="flex-1"
                color={resolveNeonColor(formData.color)}
              >
                {editingTaskId ? 'Save Changes' : 'Create Task'}
              </NeonButton>
              <button
                onClick={onClose}
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
  )
}
