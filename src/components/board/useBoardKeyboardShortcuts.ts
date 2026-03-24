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
  [key: string]: string | undefined
}

interface UseBoardKeyboardShortcutsProps {
  hoveredTaskId: string | null
  selectedTaskId: string | null
  shortcuts: Shortcuts | null | undefined
  sortedColumns: BoardColumn[]
  onOpenLabel: (taskId: string) => void
  onOpenColorPicker: (taskId: string) => void
  onOpenPriorityPicker: (taskId: string) => void
  onEditCard: (taskId: string) => void
  onAddTask: (columnId: string) => void
}

export function useBoardKeyboardShortcuts({
  hoveredTaskId,
  selectedTaskId,
  shortcuts,
  sortedColumns,
  onOpenLabel,
  onOpenColorPicker,
  onOpenPriorityPicker,
  onEditCard,
  onAddTask,
}: UseBoardKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const key = e.key.toLowerCase()

      const targetTaskId = hoveredTaskId ?? selectedTaskId
      if (key === (shortcuts?.openLabel ?? 'l') && targetTaskId) {
        e.preventDefault()
        onOpenLabel(targetTaskId)
        return
      }

      if (key === (shortcuts?.changeGlow ?? 'g') && targetTaskId) {
        e.preventDefault()
        onOpenColorPicker(targetTaskId)
        return
      }

      if (key === (shortcuts?.changePriority ?? 'v') && targetTaskId) {
        e.preventDefault()
        onOpenPriorityPicker(targetTaskId)
        return
      }

      if (key === (shortcuts?.editCard ?? 'e') && targetTaskId) {
        e.preventDefault()
        onEditCard(targetTaskId)
        return
      }

      const addKey = shortcuts?.addCard ?? shortcuts?.addTask ?? 'c'
      if (key === addKey && sortedColumns.length > 0) {
        e.preventDefault()
        onAddTask(sortedColumns[0].id)
        return
      }

      if (key === (shortcuts?.toggleDates ?? 'd')) {
        e.preventDefault()
        useBoardStore.getState().toggleShowDates()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, hoveredTaskId, shortcuts, sortedColumns, onOpenLabel, onOpenColorPicker, onOpenPriorityPicker, onEditCard, onAddTask])
}
