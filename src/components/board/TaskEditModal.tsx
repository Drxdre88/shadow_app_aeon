'use client'

import { useCallback, useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig, generateId } from '@/lib/utils/colors'
import { NeonButton } from '@/components/ui/NeonButton'
import { TaskChecklist } from './TaskChecklist'
import { TaskDependencySection } from './TaskDependencySection'
import { getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem } from '@/lib/actions/checklist'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

interface FormData {
  name: string
  description: string
  color: string
  priority: typeof PRIORITIES[number]
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
}: TaskEditModalProps) {
  const [checklistItems, setChecklistItems] = useState<
    { id: string; title: string; completed: boolean; startDate?: string; endDate?: string }[]
  >([])

  useEffect(() => {
    if (!editingTaskId) {
      setChecklistItems([])
      return
    }
    getChecklistItems(editingTaskId)
      .then((items) =>
        setChecklistItems(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            completed: i.completed,
            startDate: i.startDate ? i.startDate.toISOString() : undefined,
            endDate: i.endDate ? i.endDate.toISOString() : undefined,
          }))
        )
      )
      .catch(() => setChecklistItems([]))
  }, [editingTaskId])

  const handleChecklistAdd = useCallback((title: string) => {
    if (!editingTaskId) return
    const newItem = {
      id: generateId(),
      taskId: editingTaskId,
      title,
      orderIndex: checklistItems.length,
    }
    setChecklistItems((prev) => [...prev, { id: newItem.id, title, completed: false }])
    createChecklistItem(newItem).catch(() => {})
  }, [editingTaskId, checklistItems.length])

  const handleChecklistToggle = useCallback((itemId: string) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, completed: !i.completed } : i))
    )
    const item = checklistItems.find((i) => i.id === itemId)
    if (item) {
      updateChecklistItem(itemId, editingTaskId, { completed: !item.completed }).catch(() => {})
    }
  }, [editingTaskId, checklistItems])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTaskId) return
    setChecklistItems((prev) => prev.filter((i) => i.id !== itemId))
    deleteChecklistItem(itemId, editingTaskId).catch(() => {})
  }, [editingTaskId])

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
              'w-full max-w-md max-h-[85vh] overflow-y-auto p-6 rounded-xl',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-xl border border-white/10',
              'shadow-[0_0_40px_rgba(99,102,241,0.3)]'
            )}
          >
            <div className="flex items-center justify-between mb-6">
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

            <div className="space-y-4">
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
                  onChange={(e) => onFormChange({ ...formData, description: e.target.value })}
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
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {ACCENT_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => onFormChange({ ...formData, color })}
                        className={cn(
                          'w-8 h-8 rounded-lg transition-all duration-200',
                          colorConfig[color].bgSolid,
                          formData.color === color && 'ring-2 ring-offset-2 ring-offset-black ring-white scale-110'
                        )}
                        style={{ boxShadow: formData.color === color ? `0 0 15px ${colorConfig[color].glow}` : undefined }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {PALETTE_COLORS.map((hex) => (
                      <button
                        key={hex}
                        onClick={() => onFormChange({ ...formData, color: hex })}
                        className={cn(
                          'w-8 h-8 rounded-lg border-2 transition-all duration-200',
                          formData.color === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                        )}
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="color"
                        value={formData.color.startsWith('#') ? formData.color : colorConfig[formData.color as AccentColor]?.hex ?? '#a855f7'}
                        onChange={(e) => onFormChange({ ...formData, color: e.target.value })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div
                        className="w-8 h-8 rounded-lg border-2 border-dashed border-white/30 group-hover:border-white/60 transition-all flex items-center justify-center"
                        style={{ backgroundColor: formData.color.startsWith('#') ? formData.color : 'transparent' }}
                      >
                        {!formData.color.startsWith('#') && <span className="text-[10px] text-slate-500">+</span>}
                      </div>
                    </div>
                    <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Custom color</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1.5">Priority</label>
                <div className="flex gap-2">
                  {PRIORITIES.map((priority) => (
                    <button
                      key={priority}
                      onClick={() => onFormChange({ ...formData, priority })}
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

            {editingTaskId && (
              <>
                <div className="mt-4 pt-4 border-t border-white/10">
                  <TaskChecklist
                    taskId={editingTaskId}
                    items={checklistItems}
                    onItemAdd={handleChecklistAdd}
                    onItemToggle={handleChecklistToggle}
                    onItemRemove={handleChecklistRemove}
                  />
                </div>

                <div className="mt-4 pt-4 border-t border-white/10">
                  <TaskDependencySection
                    taskId={editingTaskId}
                    projectId={projectId}
                    onAddDependency={onAddDependency}
                    onRemoveDependency={onRemoveDependency}
                  />
                </div>
              </>
            )}

            <div className="flex gap-3 mt-6">
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
