'use client'

import { useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, Palette, Calendar, Trash2, Check, Ruler } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { AccentColor, ACCENT_COLORS, colorConfig, hexToRgba } from '@/lib/utils/colors'
import { NeonButton } from '@/components/ui/NeonButton'
import { TaskChecklist } from './checklist'
import { TaskDependencySection } from './TaskDependencySection'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { TaskComments } from './TaskComments'
import { useChecklistHandlers } from './useChecklistHandlers'
import { TaskDateSection } from './TaskDateSection'
import { TaskLabelsSection } from './TaskLabelsSection'
import { TaskMembersSection } from './TaskMembersSection'
import { useBoardSizing, sizingTooltip, sizingUnitLabel } from './sizing'
import { TaskProgressRow } from './TaskProgressRow'
import { BoardSizingModal } from './BoardSizingModal'
import { triggerCelebration } from '@/components/celebrations'

export interface TaskEditFormData {
  name: string
  description: string
  color: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  size: number | null
}

export interface TaskEditContentProps {
  editingTaskId: string | null
  formData: TaskEditFormData
  projectId: string
  onFormChange: (data: TaskEditFormData) => void
  onSubmit: () => void
  onClose: () => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  onPushToGantt?: (taskId: string) => void
  onDateChange?: (taskId: string, dates: { startDate?: string | null; endDate?: string | null }) => void
  onStatusChange?: (taskId: string, status: string) => void
  onTaskDelete?: (taskId: string) => void
  onBlurPersist?: () => void
  onProgressChange?: (taskId: string, progress: number | null) => void
  /** Sizing config overlay — state lives in the shell so Escape handling can see it. */
  sizingModalOpen: boolean
  onSizingModalOpenChange: (open: boolean) => void
  nameInputRef?: RefObject<HTMLInputElement | null>
  /** Extra controls rendered at the end of the name row (e.g. the pin button). */
  headerActions?: ReactNode
  /** Floating windows disable this so multiple open cards don't fight over focus. */
  autoFocusChecklist?: boolean
}

export const resolveNeonColor = (color: string): AccentColor =>
  ACCENT_COLORS.includes(color as AccentColor) ? (color as AccentColor) : 'purple'

/**
 * The full card-edit form: shared body + footer used by both the centered
 * TaskEditModal and the floating pinned-card windows. The shell owns
 * open/close, positioning, and keyboard scoping; this owns the fields.
 */
export function TaskEditContent({
  editingTaskId,
  formData,
  projectId,
  onFormChange,
  onSubmit,
  onClose,
  onAddDependency,
  onRemoveDependency,
  onLabelCreate,
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
  onPushToGantt,
  onDateChange,
  onStatusChange,
  onTaskDelete,
  onBlurPersist,
  onProgressChange,
  sizingModalOpen,
  onSizingModalOpenChange,
  nameInputRef,
  headerActions,
  autoFocusChecklist = true,
}: TaskEditContentProps) {
  const tasks = useBoardStore((s) => s.tasks)
  const updateTask = useBoardStore((s) => s.updateTask)
  const priorities = useThemeStore((s) => s.priorities)
  const sizing = useBoardSizing()
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

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
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-stretch gap-2">
          {editingTaskId && currentTask && (
            <button
              onClick={handleToggleDone}
              title={isDone ? 'Mark not done' : 'Mark done'}
              aria-label={isDone ? 'Mark not done' : 'Mark done'}
              aria-pressed={isDone}
              className={cn(
                'aspect-square min-w-[2.5rem] flex-shrink-0 rounded-lg border-2 flex items-center justify-center',
                'transition-all duration-200',
                isDone
                  ? 'bg-emerald-500 border-emerald-400'
                  : 'bg-white/5 border-white/25 hover:border-white/50 hover:bg-white/10'
              )}
              style={isDone ? { boxShadow: '0 0 10px rgba(16,185,129,0.5)' } : undefined}
            >
              {isDone && <Check className="w-5 h-5 text-white" />}
            </button>
          )}
          <input
            ref={nameInputRef}
            type="text"
            value={formData.name}
            onChange={(e) => onFormChange({ ...formData, name: e.target.value })}
            onBlur={onBlurPersist}
            placeholder="Task name..."
            className={cn(
              'flex-1 min-w-0 px-4 py-2.5 rounded-lg',
              'bg-white/5 border border-white/10',
              'text-white placeholder-slate-500',
              'focus:outline-none focus:ring-2 focus:ring-white/20',
              'transition-all duration-200'
            )}
          />
          {headerActions}
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
              autoFocusAdd={autoFocusChecklist && !!editingTaskId}
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

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm text-slate-400">
              {sizing.enabled ? 'Size' : 'Size (days)'}
            </label>
            <button
              onClick={() => onSizingModalOpenChange(true)}
              title={`Change what each size means in ${sizing.unit}`}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white transition-colors"
            >
              <Ruler className="w-3 h-3" />
              Edit sizes
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sizing.enabled && sizing.labels.map((sizeLabel) => {
              const isActive = formData.size === sizeLabel.value
              return (
                <button
                  key={sizeLabel.key}
                  onClick={() => onFormChange({ ...formData, size: isActive ? null : sizeLabel.value })}
                  title={sizingTooltip(sizing, sizeLabel)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200',
                    isActive
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                  )}
                  style={isActive ? { boxShadow: '0 0 8px color-mix(in srgb, var(--primary) 45%, transparent)' } : undefined}
                >
                  {sizeLabel.key}
                </button>
              )
            })}
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
              title={sizing.enabled ? `Custom size in ${sizing.unit}` : 'Size in days'}
              className={cn(
                'px-2.5 py-1.5 rounded-lg',
                'bg-white/5 border border-white/10',
                'text-white placeholder-slate-500',
                'focus:outline-none focus:ring-2 focus:ring-white/20',
                'transition-all duration-200',
                sizing.enabled ? 'w-16 text-xs' : 'w-24 text-sm'
              )}
            />
            <span className="text-xs text-slate-500">
              {formData.size ? sizingUnitLabel(sizing.unit, formData.size) : 'Auto (2d)'}
            </span>
          </div>
        </div>

        {editingTaskId && (
          <TaskProgressRow
            key={editingTaskId}
            taskId={editingTaskId}
            onProgressChange={onProgressChange}
          />
        )}

        {editingTaskId && (
          <TaskDateSection taskId={editingTaskId} onDateChange={onDateChange} />
        )}

        {editingTaskId && (
          <TaskLabelsSection
            taskId={editingTaskId}
            projectId={projectId}
            onLabelCreate={onLabelCreate}
            onLabelUpdate={onLabelUpdate}
            onLabelDelete={onLabelDelete}
            onLabelToggle={onLabelToggle}
          />
        )}

        {editingTaskId && (
          <TaskMembersSection taskId={editingTaskId} projectId={projectId} />
        )}

        <div className="pt-4 border-t border-white/10">
          <label className="block text-sm text-slate-400 mb-2">Priority</label>
          <div className="flex gap-2">
            {priorities.map((p) => {
              const isActive = formData.priority === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => onFormChange({ ...formData, priority: p.id as TaskEditFormData['priority'] })}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all duration-200',
                    'border',
                    isActive
                      ? 'bg-white/10 border-white/30 text-white'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                  )}
                  style={isActive ? { boxShadow: `0 0 8px ${hexToRgba(p.color, 0.5)}` } : undefined}
                >
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
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

      <BoardSizingModal
        isOpen={sizingModalOpen}
        projectId={projectId}
        onClose={() => onSizingModalOpenChange(false)}
      />
    </>
  )
}
