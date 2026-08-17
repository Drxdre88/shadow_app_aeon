'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Palette, Calendar, Trash2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, colorConfig } from '@/lib/utils/colors'
import { NeonButton } from '@/components/ui/NeonButton'
import { TaskChecklist } from './checklist'
import { TaskDependencySection } from './TaskDependencySection'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { TaskComments } from './TaskComments'
import { useChecklistHandlers } from './useChecklistHandlers'
import { TaskDateSection } from './TaskDateSection'
import { TaskLabelsSection } from './TaskLabelsSection'
import { useBoardSizing, sizingTooltip, sizingUnitLabel } from './sizing'
import { triggerCelebration } from '@/components/celebrations'

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
  onStatusChange?: (taskId: string, status: string) => void
  onTaskDelete?: (taskId: string) => void
  onBlurPersist?: () => void
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
  onStatusChange,
  onTaskDelete,
  onBlurPersist,
}: TaskEditModalProps) {
  const tasks = useBoardStore((s) => s.tasks)
  const updateTask = useBoardStore((s) => s.updateTask)
  const sizing = useBoardSizing()
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const {
    checklistItems,
    handleChecklistAdd,
    handleChecklistToggle,
    handleChecklistStatusChange,
    handleChecklistRemove,
    handleItemTitleChange,
    handleGroupRename,
    handleChecklistReorder,
    handleGroupDelete,
    handleGroupReorder,
  } = useChecklistHandlers(editingTaskId, projectId)

  useEffect(() => {
    if (!isOpen) return
    const isDesktop = window.matchMedia('(hover: hover)').matches
    if (isDesktop && !editingTaskId) {
      const timer = setTimeout(() => nameInputRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen, editingTaskId])

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

  const currentTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null
  const isDone = currentTask?.status === 'done'
  const handleToggleDone = (e: React.MouseEvent) => {
    if (!editingTaskId) return
    const newStatus = isDone ? 'todo' : 'done'
    updateTask(editingTaskId, { status: newStatus })
    onStatusChange?.(editingTaskId, newStatus)
    if (newStatus === 'done') triggerCelebration(e.clientX, e.clientY)
  }

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
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[90vh] flex flex-col rounded-none sm:rounded-xl',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-md border-0 sm:border border-white/10',
              'shadow-none sm:shadow-[0_0_40px_rgba(99,102,241,0.3)]'
            )}
          >
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm text-slate-400">Name</label>
                  {editingTaskId && currentTask && (
                    <button
                      onClick={handleToggleDone}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all duration-200',
                        isDone
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                          : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      <CheckCircle2 className={cn('w-3.5 h-3.5', isDone && 'fill-emerald-500/20')} />
                      {isDone ? 'Done' : 'Mark done'}
                    </button>
                  )}
                </div>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={formData.name}
                  onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
                  onBlur={onBlurPersist}
                  placeholder="Task name..."
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-white/20',
                    'transition-all duration-200'
                  )}
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
                  onBlur={onBlurPersist}
                  placeholder="Optional description..."
                  rows={2}
                  className={cn(
                    'w-full px-4 py-2.5 rounded-lg resize-none',
                    'bg-white/5 border border-white/10',
                    'text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-white/20',
                    'transition-all duration-200'
                  )}
                  onFocus={(e) => {
                    const el = e.target
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
                  }}
                />
              </div>

              {editingTaskId && (
                <div className="pt-4 border-t border-white/10">
                  <TaskChecklist
                    key={editingTaskId}
                    taskId={editingTaskId}
                    items={checklistItems}
                    autoFocusAdd={!!editingTaskId}
                    onItemAdd={handleChecklistAdd}
                    onItemToggle={handleChecklistToggle}
                    onItemRemove={handleChecklistRemove}
                    onItemStatusChange={handleChecklistStatusChange}
                    onItemTitleChange={handleItemTitleChange}
                    onGroupRename={handleGroupRename}
                    onGroupDelete={handleGroupDelete}
                    onItemReorder={handleChecklistReorder}
                    onGroupReorder={handleGroupReorder}
                  />
                </div>
              )}

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

              {sizing.enabled && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Size</label>
                  <div className="flex flex-wrap gap-2">
                    {sizing.labels.map((sizeLabel) => {
                      const isActive = formData.size === sizeLabel.value
                      return (
                        <button
                          key={sizeLabel.key}
                          onClick={() => onFormChange({ ...formData, size: isActive ? null : sizeLabel.value })}
                          title={sizingTooltip(sizing, sizeLabel)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
                            isActive
                              ? 'bg-white/10 border-white/30 text-white'
                              : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                          )}
                        >
                          {sizeLabel.key}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">
                  {sizing.enabled ? `Size (${sizing.unit})` : 'Size (days)'}
                </label>
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
                    {formData.size ? sizingUnitLabel(sizing.unit, formData.size) : 'Auto (2d)'}
                  </span>
                </div>
              </div>

              {editingTaskId && (
                <TaskDateSection taskId={editingTaskId} onDateChange={onDateChange} />
              )}

              {editingTaskId && (
                <TaskLabelsSection
                  taskId={editingTaskId}
                  projectId={projectId}
                  onLabelToggle={onLabelToggle}
                />
              )}

              <div className="pt-4 border-t border-white/10">
                <label className="block text-sm text-slate-400 mb-2">Priority</label>
                <div className="flex gap-2">
                  {PRIORITIES.map((priority) => {
                    const isActive = formData.priority === priority
                    const dotColor: Record<string, string> = { low: '#64748b', medium: '#3b82f6', high: '#f97316', urgent: '#ef4444' }
                    return (
                      <button
                        key={priority}
                        onClick={() => onFormChange({ ...formData, priority })}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all duration-200',
                          'border',
                          isActive
                            ? 'bg-white/10 border-white/30 text-white'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                        )}
                        style={isActive ? { boxShadow: `0 0 8px ${dotColor[priority]}50` } : undefined}
                      >
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dotColor[priority] }} />
                        {priority}
                      </button>
                    )
                  })}
                </div>
              </div>

              {editingTaskId && (
                <>
                  <div className="pt-4 border-t border-white/10">
                    <TaskDependencySection
                      taskId={editingTaskId}
                      projectId={projectId}
                      onAddDependency={onAddDependency}
                      onRemoveDependency={onRemoveDependency}
                    />
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    <TaskComments taskId={editingTaskId} projectId={projectId} />
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

            <div className="flex items-center gap-3 p-4 sm:p-6 pt-4 flex-shrink-0 border-t border-white/10">
              {editingTaskId && onTaskDelete && (
                <button
                  onClick={() => {
                    onTaskDelete(editingTaskId)
                    onClose()
                  }}
                  className={cn(
                    'p-2 rounded-lg',
                    'hover:bg-red-500/15 border border-transparent hover:border-red-500/20',
                    'text-slate-400 hover:text-red-400',
                    'transition-all duration-200'
                  )}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1" />
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
              <NeonButton
                onClick={onSubmit}
                disabled={!formData.name.trim()}
                color={resolveNeonColor(formData.color)}
              >
                {editingTaskId ? 'Done' : 'Create Card'}
              </NeonButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
