'use client'

import { motion } from 'framer-motion'
import { Plus, ChevronDown, ChevronRight, GripVertical, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  DndContext,
  closestCenter,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableChecklistItem } from './SortableChecklistItem'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'
import type { useSensors } from '@dnd-kit/core'

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
  sensors: ReturnType<typeof useSensors>
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
  onItemTitleChange: (id: string, title: string) => void
  onItemEditStart: (id: string, title: string) => void
  onItemEditCommit: () => void
  onItemEditCancel: () => void
  onItemEditTitleChange: (v: string) => void
  onItemDragEnd: (event: DragEndEvent) => void
  onAddStart: () => void
  onAddChange: (v: string) => void
  onAddSubmit: (e: React.FormEvent) => void
  onAddCancel: () => void
}

export function SortableGroupSection({
  groupName, items, isCollapsed, isEditing, editingGroupValue, confirmingDelete,
  editingItemId, editingItemTitle, addingInGroup, newItemTitle, titleMax, sensors,
  onToggleCollapse, onEditGroupStart, onEditGroupChange, onEditGroupCommit, onEditGroupCancel,
  onDeleteStart, onDeleteConfirm, onDeleteCancel,
  onItemToggle, onItemRemove, onItemStatusChange, onItemTitleChange,
  onItemEditStart, onItemEditCommit, onItemEditCancel, onItemEditTitleChange,
  onItemDragEnd, onAddStart, onAddChange, onAddSubmit, onAddCancel,
}: SortableGroupSectionProps) {
  const {
    attributes: groupAttributes,
    listeners: groupListeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupName })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const checkedCount = items.filter((i) => i.state === 'checked').length
  const crossedCount = items.filter((i) => i.state === 'crossed').length
  const total = items.length
  const progress = total > 0 ? (checkedCount / total) * 100 : 0

  return (
    <div ref={setNodeRef} style={style} className={cn('space-y-2', isDragging && 'opacity-50 z-50 relative')}>
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
              onDoubleClick={(e) => { e.stopPropagation(); onEditGroupStart() }}
              className="flex items-center gap-1.5 text-sm font-medium text-white hover:text-slate-300 transition-colors"
            >
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              }
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onItemDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {items.map((item) => (
                <SortableChecklistItem
                  key={item.id}
                  item={item}
                  editingItemId={editingItemId}
                  editingItemTitle={editingItemTitle}
                  onToggle={onItemToggle}
                  onRemove={onItemRemove}
                  onStatusChange={onItemStatusChange}
                  onTitleChange={onItemTitleChange}
                  onEditStart={onItemEditStart}
                  onEditCommit={onItemEditCommit}
                  onEditCancel={onItemEditCancel}
                  onEditTitleChange={onItemEditTitleChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {!isCollapsed && addingInGroup && (
        <motion.form
          onSubmit={onAddSubmit}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-0.5"
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <div className="flex-shrink-0 w-3 h-3" />
            <div className="flex-shrink-0 w-5 h-5 rounded border-2 border-white/10" />
            <input
              type="text"
              value={newItemTitle}
              onChange={(e) => onAddChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onAddCancel() }}
              onBlur={() => { if (!newItemTitle.trim()) onAddCancel() }}
              placeholder="Add an item..."
              className={cn(
                'flex-1 px-0 py-0 text-sm bg-transparent border-none',
                'text-white placeholder-slate-500',
                'focus:outline-none',
                newItemTitle.length > titleMax && 'text-red-400'
              )}
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
        </motion.form>
      )}

      {!isCollapsed && !addingInGroup && (
        <button
          onClick={onAddStart}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors mt-1"
        >
          <Plus className="w-3 h-3" />
          Add item
        </button>
      )}
    </div>
  )
}
