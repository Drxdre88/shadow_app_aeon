'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GripHorizontal, Minus, PinOff, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { usePinnedCardsStore, type PinnedCard } from '@/lib/store/pinnedCardsStore'
import { TaskEditContent, type TaskEditFormData } from './TaskEditContent'

/** Mirrors the updatable fields of TaskBoard's BoardTaskData. */
export interface FloatingTaskUpdates {
  name?: string
  description?: string
  columnId?: string
  status?: string
  priority?: string
  color?: string
  labels?: string[]
  onTimeline?: boolean
  orderIndex?: number
  startDate?: string
  endDate?: string
  size?: number | null
  progress?: number | null
  ganttTaskId?: string | null
}

export interface FloatingCardCallbacks {
  onTaskUpdate?: (taskId: string, updates: FloatingTaskUpdates, options?: { silent?: boolean }) => void
  onTaskDelete?: (taskId: string) => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  onPushToGantt?: (taskId: string) => void
}

interface FloatingCardWindowProps extends FloatingCardCallbacks {
  card: PinnedCard
  projectId: string
  /** Return this card to the normal centered-modal flow. */
  onUnpin: (taskId: string) => void
}

function seedFormData(taskId: string): TaskEditFormData {
  const task = useBoardStore.getState().tasks.find((t) => t.id === taskId)
  return {
    name: task?.name ?? '',
    description: task?.description ?? '',
    color: task?.color ?? 'purple',
    priority: (task?.priority as TaskEditFormData['priority']) ?? 'medium',
    size: task?.size ?? null,
  }
}

/**
 * A pinned card as a draggable floating panel. The board stays fully
 * interactive underneath — there is no backdrop. Dragging is plain pointer
 * capture (works with reduce-motion on; the CSS kill-switch only strips
 * animation, not capability) and never reaches the board's dnd-kit sensors:
 * the window lives outside the board's DndContext and stops propagation.
 */
export function FloatingCardWindow({
  card,
  projectId,
  onUnpin,
  onTaskUpdate,
  onTaskDelete,
  onAddDependency,
  onRemoveDependency,
  onLabelCreate,
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
  onPushToGantt,
}: FloatingCardWindowProps) {
  const taskId = card.taskId
  const setPosition = usePinnedCardsStore((s) => s.setPosition)
  const setFolded = usePinnedCardsStore((s) => s.setFolded)
  const closeCard = usePinnedCardsStore((s) => s.closeCard)
  const bringToFront = usePinnedCardsStore((s) => s.bringToFront)

  const [formData, setFormData] = useState<TaskEditFormData>(() => seedFormData(taskId))
  const [sizingModalOpen, setSizingModalOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formDataRef = useRef(formData)
  formDataRef.current = formData

  const persist = useCallback(
    (data: TaskEditFormData) => {
      const name = data.name.trim()
      if (!name) return
      const updates = {
        name,
        description: data.description.trim() || undefined,
        color: data.color,
        priority: data.priority,
        size: data.size,
      }
      useBoardStore.getState().updateTask(taskId, updates)
      onTaskUpdate?.(taskId, updates, { silent: true })
    },
    [taskId, onTaskUpdate]
  )

  const flushAutosave = useCallback(() => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    }
    persist(formDataRef.current)
  }, [persist])

  // Same autosave contract as the modal: debounce while typing, flush on
  // blur / close / unmount so nothing is lost when the window goes away.
  const handleFormChange = useCallback(
    (data: TaskEditFormData) => {
      setFormData(data)
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(() => {
        autosaveTimer.current = null
        persist(data)
      }, 700)
    },
    [persist]
  )

  useEffect(
    () => () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
        persist(formDataRef.current)
      }
    },
    [persist]
  )

  const handleClose = useCallback(() => {
    flushAutosave()
    closeCard(taskId)
  }, [flushAutosave, closeCard, taskId])

  const handleFold = useCallback(() => {
    flushAutosave()
    setFolded(taskId, true)
  }, [flushAutosave, setFolded, taskId])

  const handleUnpin = useCallback(() => {
    flushAutosave()
    onUnpin(taskId)
  }, [flushAutosave, onUnpin, taskId])

  // Newly pinned/restored window takes focus so Escape targets it immediately.
  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true })
  }, [])

  // --- title-bar drag (pointer capture; no library, reduce-motion-proof) ---
  const dragState = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  const handleTitlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('button')) return
    dragState.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - card.x,
      offsetY: e.clientY - card.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const handleTitlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragState.current
    if (!s || s.pointerId !== e.pointerId) return
    setPosition(taskId, e.clientX - s.offsetX, e.clientY - s.offsetY)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== e.pointerId) return
    dragState.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handleShellKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep floating-card keys away from board shortcuts / the modal's
    // window-level listeners.
    e.stopPropagation()
    if (e.key === 'Escape') {
      // The sizing overlay portals to body but bubbles through the React
      // tree — let it take the key first, like the modal does.
      if (sizingModalOpen) {
        setSizingModalOpen(false)
        return
      }
      handleClose()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (formData.name.trim()) handleClose()
    }
  }

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-label={`Pinned card: ${formData.name || 'Untitled'}`}
      tabIndex={-1}
      data-floating-card={taskId}
      onPointerDown={(e) => {
        e.stopPropagation()
        bringToFront(taskId)
      }}
      onKeyDown={handleShellKeyDown}
      className={cn(
        'pointer-events-auto absolute flex flex-col rounded-xl overflow-hidden',
        'bg-gradient-to-b from-white/10 to-black/60',
        'backdrop-blur-md border border-white/15',
        'focus:outline-none'
      )}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: '80vh',
        zIndex: card.z,
        // Inline, not a Tailwind arbitrary value: a comma-bearing color inside
        // color-mix() breaks the generated --tw-shadow-colored variant and
        // fails the production CSS parse.
        boxShadow: '0 8px 40px color-mix(in srgb, var(--primary) 25%, rgba(0, 0, 0, 0.5))',
      }}
    >
      <div
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'flex items-center gap-2 px-3 py-2 flex-shrink-0 select-none cursor-grab active:cursor-grabbing',
          'bg-white/5 border-b border-white/10',
          'touch-none' // let pointer events own the gesture on touch devices
        )}
        data-floating-card-handle
      >
        <GripHorizontal className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-300">
          {formData.name || 'Untitled card'}
        </span>
        <button
          onClick={handleFold}
          title="Fold away"
          aria-label="Fold away"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleUnpin}
          title="Unpin (back to modal)"
          aria-label="Unpin (back to modal)"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <PinOff className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleClose}
          title="Close"
          aria-label="Close pinned card"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <TaskEditContent
        editingTaskId={taskId}
        formData={formData}
        projectId={projectId}
        onFormChange={handleFormChange}
        onSubmit={handleClose}
        onClose={handleClose}
        onBlurPersist={flushAutosave}
        onAddDependency={onAddDependency}
        onRemoveDependency={onRemoveDependency}
        onLabelCreate={onLabelCreate}
        onLabelUpdate={onLabelUpdate}
        onLabelDelete={onLabelDelete}
        onLabelToggle={onLabelToggle}
        onPushToGantt={onPushToGantt}
        onDateChange={(id, dates) => onTaskUpdate?.(id, dates as FloatingTaskUpdates)}
        onStatusChange={(id, status) => onTaskUpdate?.(id, { status })}
        onProgressChange={(id, progress) => onTaskUpdate?.(id, { progress }, { silent: true })}
        onTaskDelete={onTaskDelete}
        sizingModalOpen={sizingModalOpen}
        onSizingModalOpenChange={setSizingModalOpen}
        autoFocusChecklist={false}
      />
    </div>
  )
}
