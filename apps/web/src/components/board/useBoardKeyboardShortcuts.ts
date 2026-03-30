import { useEffect } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import type { BoardColumn } from '@/lib/store/boardStore'

interface Shortcuts {
  openLabel?: string
  changeGlow?: string
  changePriority?: string
  addCard?: string
  addTask?: string
  editCard?: string
  toggleDates?: string
  selectCard?: string
  [key: string]: string | undefined
}

interface UseBoardKeyboardShortcutsProps {
  hoveredTaskId: string | null
  selectedTaskId: string | null
  shortcuts: Shortcuts | null | undefined
  sortedColumns: BoardColumn[]
  hasOpenOverlay: boolean
  onOpenLabel: (taskId: string) => void
  onOpenColorPicker: (taskId: string) => void
  onOpenPriorityPicker: (taskId: string) => void
  onEditCard: (taskId: string) => void
  onAddTask: (columnId: string) => void
  onCopyCard?: (taskId: string) => void
  onPasteCard?: () => void
  onSelectTask: (taskId: string | null) => void
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
}

export function useBoardKeyboardShortcuts({
  hoveredTaskId,
  selectedTaskId,
  shortcuts,
  sortedColumns,
  hasOpenOverlay,
  onOpenLabel,
  onOpenColorPicker,
  onOpenPriorityPicker,
  onEditCard,
  onAddTask,
  onCopyCard,
  onPasteCard,
  onSelectTask,
  onTaskMove,
}: UseBoardKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const key = e.key.toLowerCase()

      const targetTaskId = hoveredTaskId ?? selectedTaskId

      if ((e.ctrlKey || e.metaKey) && key === 'c' && targetTaskId) {
        e.preventDefault()
        onCopyCard?.(targetTaskId)
        return
      }

      if ((e.ctrlKey || e.metaKey) && key === 'v') {
        e.preventDefault()
        onPasteCard?.()
        return
      }

      if (key === 'escape') {
        if (hasOpenOverlay) return
        if (selectedTaskId) {
          e.preventDefault()
          onSelectTask(null)
          return
        }
      }

      if (key === (shortcuts?.selectCard ?? 's').toLowerCase()) {
        e.preventDefault()
        if (hoveredTaskId) {
          onSelectTask(hoveredTaskId === selectedTaskId ? null : hoveredTaskId)
        } else if (selectedTaskId) {
          onSelectTask(null)
        }
        return
      }

      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedTaskId) {
        e.preventDefault()
        handleArrowMove(key, selectedTaskId, sortedColumns, onTaskMove)
        return
      }

      if (key === (shortcuts?.openLabel ?? 'l').toLowerCase() && targetTaskId) {
        e.preventDefault()
        onOpenLabel(targetTaskId)
        return
      }

      if (key === (shortcuts?.changeGlow ?? 'g').toLowerCase() && targetTaskId) {
        e.preventDefault()
        onOpenColorPicker(targetTaskId)
        return
      }

      if (key === (shortcuts?.changePriority ?? 'v').toLowerCase() && targetTaskId) {
        e.preventDefault()
        onOpenPriorityPicker(targetTaskId)
        return
      }

      if (key === (shortcuts?.editCard ?? 'e').toLowerCase() && targetTaskId) {
        e.preventDefault()
        onEditCard(targetTaskId)
        return
      }

      const addKey = (shortcuts?.addCard ?? shortcuts?.addTask ?? 'c').toLowerCase()
      if (key === addKey && sortedColumns.length > 0) {
        e.preventDefault()
        onAddTask(sortedColumns[0].id)
        return
      }

      if (key === (shortcuts?.toggleDates ?? 'd').toLowerCase()) {
        e.preventDefault()
        useBoardStore.getState().toggleShowDates()
        return
      }

      if (key === (shortcuts?.toggleChecklist ?? 'o').toLowerCase()) {
        e.preventDefault()
        useBoardStore.getState().toggleChecklistPreview()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, hoveredTaskId, shortcuts, sortedColumns, hasOpenOverlay, onOpenLabel, onOpenColorPicker, onOpenPriorityPicker, onEditCard, onAddTask, onCopyCard, onPasteCard, onSelectTask, onTaskMove])
}

function handleArrowMove(
  key: string,
  taskId: string,
  sortedColumns: BoardColumn[],
  onTaskMove?: (updates: { id: string; orderIndex: number; status?: string; columnId?: string; name?: string }[], snapshot?: { id: string; columnId?: string; orderIndex: number }[]) => void
) {
  const { tasks, moveTask, swapTaskOrder } = useBoardStore.getState()
  const task = tasks.find(t => t.id === taskId)
  if (!task || !task.columnId) return

  const colIndex = sortedColumns.findIndex(c => c.id === task.columnId)
  if (colIndex === -1) return

  const columnTasks = tasks
    .filter(t => t.columnId === task.columnId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const taskIndex = columnTasks.findIndex(t => t.id === taskId)

  const snapshot = tasks.map(t => ({ id: t.id, columnId: t.columnId, orderIndex: t.orderIndex }))

  if (key === 'arrowleft' || key === 'arrowright') {
    const newColIndex = key === 'arrowleft' ? colIndex - 1 : colIndex + 1
    if (newColIndex < 0 || newColIndex >= sortedColumns.length) return

    const targetColumn = sortedColumns[newColIndex]
    const targetTasks = tasks.filter(t => t.columnId === targetColumn.id)
    const newOrder = Math.min(taskIndex, targetTasks.length)
    const isDone = targetColumn.name.toLowerCase() === 'done'

    moveTask(taskId, targetColumn.id, newOrder)

    onTaskMove?.(
      [{ id: taskId, orderIndex: newOrder, columnId: targetColumn.id, name: task.name, ...(isDone && { status: 'done' }) }],
      snapshot
    )

    scrollTaskIntoView(taskId)
    return
  }

  if (key === 'arrowup' || key === 'arrowdown') {
    const swapIndex = key === 'arrowup' ? taskIndex - 1 : taskIndex + 1
    if (swapIndex < 0 || swapIndex >= columnTasks.length) return

    const swapTask = columnTasks[swapIndex]

    swapTaskOrder(taskId, swapIndex, swapTask.id, taskIndex)

    onTaskMove?.(
      [
        { id: taskId, orderIndex: swapIndex },
        { id: swapTask.id, orderIndex: taskIndex },
      ],
      snapshot
    )

    scrollTaskIntoView(taskId)
  }
}

function scrollTaskIntoView(taskId: string) {
  requestAnimationFrame(() => {
    document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
