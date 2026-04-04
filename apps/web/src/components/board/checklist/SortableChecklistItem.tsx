'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { TriStateCheckbox, nextState } from './TriStateCheckbox'
import { StatusBadge } from './StatusBadge'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'

interface SortableChecklistItemProps {
  item: ChecklistItem
  editingItemId: string | null
  editingItemTitle: string
  onToggle: (itemId: string, newState: CheckState) => void
  onRemove: (itemId: string) => void
  onStatusChange: (itemId: string, status: ChecklistStatus) => void
  onEditStart: (itemId: string, title: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onEditTitleChange: (value: string) => void
}

export function SortableChecklistItem({
  item,
  editingItemId,
  editingItemTitle,
  onToggle,
  onRemove,
  onStatusChange,
  onEditStart,
  onEditCommit,
  onEditCancel,
  onEditTitleChange,
}: SortableChecklistItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group p-2.5 rounded-lg border transition-colors duration-200',
        'bg-white/[0.03] border-white/[0.06]',
        item.state === 'checked' && 'border-emerald-500/10',
        item.state === 'crossed' && 'border-red-500/10',
        isDragging && 'opacity-50 scale-[1.02] shadow-lg shadow-black/40 z-50 relative'
      )}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing transition-opacity touch-none"
          tabIndex={-1}
        >
          <GripVertical className="w-3 h-3 text-slate-600" />
        </button>

        <TriStateCheckbox
          state={item.state}
          onClick={() => onToggle(item.id, nextState(item.state))}
        />

        {editingItemId === item.id ? (
          <form
            onSubmit={(e) => { e.preventDefault(); onEditCommit() }}
            className="flex-1 min-w-0"
          >
            <textarea
              value={editingItemTitle}
              onChange={(e) => {
                onEditTitleChange(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onBlur={onEditCommit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onEditCancel()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onEditCommit()
                }
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
              className={cn(
                'w-full px-2 py-0.5 rounded-md text-sm resize-none',
                'bg-white/5 border border-white/20',
                'text-white',
                'focus:outline-none focus:ring-1 focus:ring-emerald-500/40'
              )}
              rows={1}
              autoFocus
              autoComplete="off"
            />
          </form>
        ) : (
          <p
            onDoubleClick={() => onEditStart(item.id, item.title)}
            className={cn(
              'flex-1 text-sm transition-all duration-200 min-w-0 cursor-text',
              item.state === 'checked' && 'line-through text-slate-500',
              item.state === 'crossed' && 'line-through text-red-400/50',
              item.state === 'unchecked' && 'text-slate-300'
            )}
          >
            {item.title}
          </p>
        )}

        <StatusBadge
          status={item.status}
          onStatusChange={(s) => onStatusChange(item.id, s)}
        />

        <button
          onClick={() => onRemove(item.id)}
          className={cn(
            'flex-shrink-0 p-1 rounded text-slate-600 hover:text-red-400',
            'hover:bg-red-500/10 transition-all duration-200',
            'opacity-0 group-hover:opacity-100'
          )}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {(item.startDate || item.endDate) && (
        <div className="flex items-center gap-1 mt-1.5 ml-12 text-xs text-slate-500">
          <Calendar className="w-3 h-3" />
          {item.startDate && format(new Date(item.startDate), 'MMM d')}
          {item.startDate && item.endDate && ' - '}
          {item.endDate && format(new Date(item.endDate), 'MMM d')}
        </div>
      )}
    </div>
  )
}
