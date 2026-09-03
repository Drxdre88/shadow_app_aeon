'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableChecklistItem, DropLine } from './SortableChecklistItem'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'

interface SortableGroupSectionProps {
  groupName: string
  items: ChecklistItem[]
  isCollapsed: boolean
  isEditing: boolean
  editingGroupValue: string
  confirmingDelete: boolean
  editingItemId: string | null
  editingItemTitle: string
  addingInGroup: boolean
  newItemTitle: string
  titleMax: number
  /** Item being dragged anywhere in the checklist (excluded from slot math). */
  activeDragItemId?: string | null
  /** Drop slot inside THIS group (0..items-without-active), or null. */
  dropIndex?: number | null
  onToggleCollapse: () => void
  onEditGroupStart: () => void
  onEditGroupChange: (v: string) => void
  onEditGroupCommit: () => void
  onEditGroupCancel: () => void
  onDeleteStart: () => void
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  onItemToggle: (id: string, state: CheckState) => void
  onItemRemove: (id: string) => void
  onItemStatusChange: (id: string, status: ChecklistStatus) => void
  onItemEditStart: (id: string, title: string) => void
  onItemEditCommit: () => void
  onItemEditCancel: () => void
  onItemEditTitleChange: (v: string) => void
  onAddStart: () => void
  onAddChange: (v: string) => void
  onAddSubmit: (e: React.FormEvent) => void
  onAddCommit: () => void
  onAddCancel: () => void
}

export function SortableGroupSection({
  groupName, items, isCollapsed, isEditing, editingGroupValue, confirmingDelete,
  editingItemId, editingItemTitle, addingInGroup, newItemTitle, titleMax,
  activeDragItemId, dropIndex,
  onToggleCollapse, onEditGroupStart, onEditGroupChange, onEditGroupCommit, onEditGroupCancel,
  onDeleteStart, onDeleteConfirm, onDeleteCancel,
  onItemToggle, onItemRemove, onItemStatusChange,
  onItemEditStart, onItemEditCommit, onItemEditCancel, onItemEditTitleChange,
  onAddStart, onAddChange, onAddSubmit, onAddCommit, onAddCancel,
}: SortableGroupSectionProps) {
  const justSubmittedRef = useRef(false)
  const justCancelledRef = useRef(false)

  const {
    attributes: groupAttributes,
    listeners: groupListeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupName, data: { type: 'group' } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // The slot counts rows without the dragged one; the line sits above the row
  // now at that slot, or below the last row when the slot is past the end.
  const slotRows = items.filter((i) => i.id !== activeDragItemId)
  const hasSlot = dropIndex !== null && dropIndex !== undefined
  const indicatorFor = (id: string): 'before' | 'after' | null => {
    if (!hasSlot) return null
    if (slotRows[dropIndex]?.id === id) return 'before'
    if (dropIndex >= slotRows.length && slotRows[slotRows.length - 1]?.id === id) return 'after'
    return null
  }

  const checkedCount = items.filter((i) => i.state === 'checked').length
  const crossedCount = items.filter((i) => i.state === 'crossed').length
  const total = items.length
  const progress = total > 0 ? (checkedCount / total) * 100 : 0

  return (
    <div ref={setNodeRef} style={style} data-checklist-group={groupName} className={cn('space-y-2', isDragging && 'opacity-50 z-50 relative')}>
      <div className="flex items-center justify-between group/header">
        {isEditing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onEditGroupCommit() }}
            className="flex items-center gap-1.5 flex-1"
          >
            <input
              type="text"
              value={editingGroupValue}
              onChange={(e) => onEditGroupChange(e.target.value)}
              onBlur={onEditGroupCommit}
              onKeyDown={(e) => { if (e.key === 'Escape') onEditGroupCancel() }}
              className={cn(
                'flex-1 px-2 py-0.5 rounded-md text-sm font-medium',
                'bg-white/5 border border-white/20',
                'text-white',
                'focus:outline-none focus:ring-1 focus:ring-white/20'
              )}
              autoFocus
              autoComplete="off"
            />
          </form>
        ) : (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <button
              {...groupAttributes}
              {...groupListeners}
              className="flex-shrink-0 opacity-0 group-hover/header:opacity-100 cursor-grab active:cursor-grabbing transition-opacity touch-none"
              tabIndex={-1}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-600" />
            </button>
            <button
              onClick={onToggleCollapse}
              className="flex-shrink-0 p-0.5 hover:bg-white/5 rounded transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              }
            </button>
            <button
              onClick={() => { if (isCollapsed) onToggleCollapse(); onEditGroupStart() }}
              className="flex items-center gap-1.5 text-sm font-medium text-white hover:text-slate-300 transition-colors min-w-0"
            >
              {groupName}
              <span className="text-xs text-slate-500 font-normal ml-1">
                {checkedCount}/{total}
                {crossedCount > 0 && <span className="text-red-400/60 ml-1">({crossedCount} blocked)</span>}
              </span>
            </button>
          </div>
        )}

        {confirmingDelete ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] text-red-400 mr-1">Delete {total} items?</span>
            <button
              onClick={onDeleteConfirm}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={onDeleteCancel}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={onDeleteStart}
            className={cn(
              'flex-shrink-0 p-1 rounded text-slate-600 hover:text-red-400',
              'hover:bg-red-500/10 transition-all duration-200',
              'opacity-0 group-hover/header:opacity-100'
            )}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {total > 0 && !isCollapsed && (
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, #10b981, #06d6a0)',
              boxShadow: '0 0 8px rgba(16,185,129,0.5)',
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {!isCollapsed && (
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1 min-h-[8px]">
            {hasSlot && slotRows.length === 0 && <DropLine data-drop-indicator="empty" />}
            {items.map((item) => (
              <SortableChecklistItem
                key={item.id}
                item={item}
                dropIndicator={indicatorFor(item.id)}
                editingItemId={editingItemId}
                editingItemTitle={editingItemTitle}
                onToggle={onItemToggle}
                onRemove={onItemRemove}
                onStatusChange={onItemStatusChange}
                onEditStart={onItemEditStart}
                onEditCommit={onItemEditCommit}
                onEditCancel={onItemEditCancel}
                onEditTitleChange={onItemEditTitleChange}
              />
            ))}
          </div>
        </SortableContext>
      )}

      {isCollapsed && hasSlot && <DropLine data-drop-indicator="collapsed" />}

      {!isCollapsed && addingInGroup && (
        <form
          onSubmit={onAddSubmit}
          className="space-y-0.5"
        >
          <div className="flex items-start gap-2 px-2.5 py-1.5">
            <div className="flex-shrink-0 w-3 h-3 mt-1" />
            <div className="flex-shrink-0 w-5 h-5 rounded border-2 border-white/10 mt-0.5" />
            <textarea
              value={newItemTitle}
              onChange={(e) => {
                onAddChange(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  justCancelledRef.current = true
                  setTimeout(() => { justCancelledRef.current = false }, 100)
                  onAddCancel()
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (newItemTitle.trim()) {
                    justSubmittedRef.current = true
                    const form = e.currentTarget.closest('form')
                    if (form) form.requestSubmit()
                    setTimeout(() => { justSubmittedRef.current = false }, 100)
                  }
                }
              }}
              onBlur={() => {
                if (justSubmittedRef.current || justCancelledRef.current) return
                // Click-away with text typed commits it (Trello-style); an
                // empty input just closes. Esc still cancels via onKeyDown.
                if (newItemTitle.trim()) onAddCommit()
                else onAddCancel()
              }}
              placeholder="New item…"
              className={cn(
                'flex-1 px-0 py-0 text-sm bg-transparent border-none resize-none',
                'text-white placeholder-slate-500',
                'focus:outline-none',
                newItemTitle.length > titleMax && 'text-red-400'
              )}
              rows={1}
              autoFocus
              autoComplete="off"
            />
          </div>
          {newItemTitle.length > titleMax * 0.9 && (
            <p className={cn(
              'text-[10px] ml-9',
              newItemTitle.length > titleMax ? 'text-red-400' : 'text-slate-500'
            )}>
              {newItemTitle.length}/{titleMax}
            </p>
          )}
        </form>
      )}

      {!isCollapsed && !addingInGroup && (
        <button
          onClick={onAddStart}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-400 transition-colors px-2.5 py-1.5"
        >
          <div className="flex-shrink-0 w-3 h-3" />
          <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
            <Plus className="w-3 h-3" />
          </div>
          Add item
        </button>
      )}
    </div>
  )
}
