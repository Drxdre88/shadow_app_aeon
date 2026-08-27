'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useBoardStore, type BoardColumn, type BoardTask } from '@/lib/store/boardStore'
import { usePinnedCardsStore, isCardPinned } from '@/lib/store/pinnedCardsStore'
import { useZenModeStore } from '@/lib/store/zenModeStore'
import { generateId } from '@/lib/utils/colors'
import type { TaskEditFormData } from './TaskEditContent'

export interface BoardTaskData {
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
  size?: number | null
  progress?: number | null
  ganttTaskId?: string | null
}

/** The picker/popover overlays the board opens over a single card. */
export interface BoardOverlayState {
  dependencyTreeTaskId: string | null
  setDependencyTreeTaskId: Dispatch<SetStateAction<string | null>>
  labelPickerTaskId: string | null
  setLabelPickerTaskId: Dispatch<SetStateAction<string | null>>
  colorPickerTaskId: string | null
  setColorPickerTaskId: Dispatch<SetStateAction<string | null>>
  priorityPickerTaskId: string | null
  setPriorityPickerTaskId: Dispatch<SetStateAction<string | null>>
  assigneeTaskId: string | null
  setAssigneeTaskId: Dispatch<SetStateAction<string | null>>
  progressTaskId: string | null
  setProgressTaskId: Dispatch<SetStateAction<string | null>>
  sizeTaskId: string | null
  setSizeTaskId: Dispatch<SetStateAction<string | null>>
}

const BLANK_FORM: TaskEditFormData = { name: '', description: '', color: 'purple', priority: 'medium', size: null }

interface UseBoardOverlaysProps {
  projectId: string
  projectTasks: BoardTask[]
  sortedColumns: BoardColumn[]
  onTaskCreate?: (task: BoardTaskData) => void
  onTaskUpdate?: (taskId: string, updates: Partial<BoardTaskData>, options?: { silent?: boolean }) => void
}

/**
 * Everything the board layers ON TOP of the columns: the card edit modal and
 * its autosave contract, the per-card pickers, the pin/unpin handover with the
 * floating-window layer, and the Zen focus column. Kept out of TaskBoard so
 * that file stays the board's composition root.
 */
export function useBoardOverlays({
  projectId,
  projectTasks,
  sortedColumns,
  onTaskCreate,
  onTaskUpdate,
}: UseBoardOverlaysProps) {
  const addTask = useBoardStore((s) => s.addTask)
  const updateTask = useBoardStore((s) => s.updateTask)
  const selectTask = useBoardStore((s) => s.selectTask)

  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [dependencyTreeTaskId, setDependencyTreeTaskId] = useState<string | null>(null)
  const [labelPickerTaskId, setLabelPickerTaskId] = useState<string | null>(null)
  const [colorPickerTaskId, setColorPickerTaskId] = useState<string | null>(null)
  const [priorityPickerTaskId, setPriorityPickerTaskId] = useState<string | null>(null)
  const [assigneeTaskId, setAssigneeTaskId] = useState<string | null>(null)
  const [progressTaskId, setProgressTaskId] = useState<string | null>(null)
  const [sizeTaskId, setSizeTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState<TaskEditFormData>(BLANK_FORM)

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formDataRef = useRef(formData)
  formDataRef.current = formData
  // formData is a SNAPSHOT taken when the modal opened. Until the user edits
  // something the task may have drifted away from it (a peer's Pusher update,
  // a rename from the context menu, an unpin flush). Flushing unconditionally
  // would write that stale snapshot back — so every flush is gated on this.
  // Same contract as FloatingCardWindow.
  const formDirty = useRef(false)

  const handleAddTask = useCallback((columnId: string) => {
    setFormData({ ...BLANK_FORM })
    formDirty.current = false
    setNewTaskColumnId(columnId)
    setEditingTask(null)
  }, [])

  const handleTaskEdit = useCallback((taskId: string) => {
    selectTask(taskId)
    // Already open as a floating window — refocus it instead of opening a
    // second editor on the same card.
    if (isCardPinned(taskId)) {
      usePinnedCardsStore.getState().openCard(taskId)
      return
    }
    // Read the task LIVE from the store, never from this render's `tasks`
    // closure. Unpin calls straight into here from the floating window's own
    // click handler: that window has just flushed its pending edit into the
    // store, but React has not re-rendered TaskBoard yet, so the closed-over
    // array still holds the pre-edit row. Seeding from it would put the stale
    // title in the modal — and the modal's own flush would then write it back
    // over the edit the user just made.
    const task = useBoardStore.getState().tasks.find((t) => t.id === taskId)
    if (task) {
      setFormData({
        name: task.name,
        description: task.description || '',
        color: task.color,
        priority: task.priority,
        size: task.size ?? null,
      })
      formDirty.current = false
      setEditingTask(taskId)
      setNewTaskColumnId(null)
    }
  }, [selectTask])

  const persistEdit = useCallback((data: TaskEditFormData, taskId: string) => {
    const name = data.name.trim()
    if (!name) return
    const updates = {
      name,
      description: data.description.trim() || undefined,
      color: data.color,
      priority: data.priority,
      size: data.size,
    }
    updateTask(taskId, updates)
    onTaskUpdate?.(taskId, updates, { silent: true })
  }, [updateTask, onTaskUpdate])

  const flushAutosave = useCallback(() => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null }
    if (!formDirty.current) return
    formDirty.current = false
    if (editingTask) persistEdit(formDataRef.current, editingTask)
  }, [editingTask, persistEdit])

  // Autosave title/description (Linear/Trello-style): debounce while typing and
  // flush on blur / close / unmount, so edits aren't lost when the modal is
  // dismissed without pressing the button.
  const handleFormChange = useCallback((data: TaskEditFormData) => {
    setFormData(data)
    if (!editingTask) return
    formDirty.current = true
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    const taskId = editingTask
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null
      formDirty.current = false
      persistEdit(data, taskId)
    }, 700)
  }, [editingTask, persistEdit])

  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }, [])

  const handleSubmit = useCallback(() => {
    if (editingTask) {
      // Edits already autosaved; the button just flushes any pending write
      // and closes.
      flushAutosave()
      setEditingTask(null)
      return
    }
    if (!formData.name.trim()) return

    if (newTaskColumnId) {
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
        size: formData.size,
        orderIndex: maxOrder + 1,
      }
      addTask(newTask)
      onTaskCreate?.(newTask)
      setNewTaskColumnId(null)
      requestAnimationFrame(() => {
        document.querySelector(`[data-task-id="${CSS.escape(newTask.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }, [formData, editingTask, newTaskColumnId, projectTasks, projectId, addTask, onTaskCreate, flushAutosave])

  const closeModal = useCallback(() => {
    flushAutosave()
    setEditingTask(null)
    setNewTaskColumnId(null)
  }, [flushAutosave])

  // Pin: pop the open modal card out as a floating window. The modal (and
  // its backdrop) closes, leaving the board fully interactive.
  const handlePinCard = useCallback((taskId: string) => {
    flushAutosave()
    setEditingTask(null)
    setNewTaskColumnId(null)
    usePinnedCardsStore.getState().openCard(taskId)
  }, [flushAutosave])

  // Unpin: close the floating window and reopen the card as a normal modal.
  const handleUnpinCard = useCallback((taskId: string) => {
    usePinnedCardsStore.getState().closeCard(taskId)
    handleTaskEdit(taskId)
  }, [handleTaskEdit])

  const hasOpenOverlay = !!editingTask || !!newTaskColumnId || !!labelPickerTaskId || !!colorPickerTaskId || !!priorityPickerTaskId || !!dependencyTreeTaskId || !!assigneeTaskId || !!progressTaskId || !!sizeTaskId

  const zenColumnId = useZenModeStore((s) => s.columnId)
  const zenColumn = useMemo(
    () => (zenColumnId ? sortedColumns.find((c) => c.id === zenColumnId) ?? null : null),
    [zenColumnId, sortedColumns]
  )

  // Focused column deleted or the board switched projects: drop Zen rather
  // than exit-fly into a slot that no longer exists.
  useEffect(() => {
    if (zenColumnId && !zenColumn) useZenModeStore.getState().clear()
  }, [zenColumnId, zenColumn])

  const overlayState: BoardOverlayState = {
    dependencyTreeTaskId,
    setDependencyTreeTaskId,
    labelPickerTaskId,
    setLabelPickerTaskId,
    colorPickerTaskId,
    setColorPickerTaskId,
    priorityPickerTaskId,
    setPriorityPickerTaskId,
    assigneeTaskId,
    setAssigneeTaskId,
    progressTaskId,
    setProgressTaskId,
    sizeTaskId,
    setSizeTaskId,
  }

  return {
    editingTask,
    newTaskColumnId,
    formData,
    isModalOpen: editingTask !== null || newTaskColumnId !== null,
    hasOpenOverlay,
    zenColumnId,
    zenColumn,
    overlayState,
    handleAddTask,
    handleTaskEdit,
    handleFormChange,
    handleSubmit,
    closeModal,
    flushAutosave,
    handlePinCard,
    handleUnpinCard,
  }
}
