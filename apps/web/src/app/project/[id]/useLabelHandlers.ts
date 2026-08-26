'use client'

import { useCallback } from 'react'
import { createLabel, updateLabel, deleteLabel, addLabelToTask, removeLabelFromTask } from '@/lib/actions/labels'
import { useBoardStore } from '@/lib/store/boardStore'
import { toast } from '@/components/ui/Toast'

export function useLabelHandlers(projectId: string) {
  // Resolves true once the label exists server-side (false on failure) so
  // callers can sequence follow-up writes (e.g. assigning the fresh label
  // to a task) instead of racing the create.
  const handleLabelCreate = useCallback((label: { id: string; projectId: string; name: string; color: string }): Promise<boolean> => {
    return createLabel(label)
      .then(() => true)
      .catch((err) => {
        console.error('Failed to create label:', err)
        useBoardStore.getState().removeLabel(label.id)
        toast('Failed to create label')
        return false
      })
  }, [])

  const handleLabelUpdate = useCallback((labelId: string, updates: { name?: string; color?: string }) => {
    const snapshot = useBoardStore.getState().labels.find(l => l.id === labelId)
    updateLabel(labelId, projectId, updates)
      .then(() => {
        if (snapshot) {
          const rollback: Record<string, unknown> = {}
          for (const key of Object.keys(updates)) {
            rollback[key] = (snapshot as unknown as Record<string, unknown>)[key]
          }
          toast('Label updated', {
            onUndo: () => {
              useBoardStore.getState().updateLabel(labelId, rollback as Partial<typeof snapshot>)
              updateLabel(labelId, projectId, rollback as { name?: string; color?: string }).catch(() => toast('Failed to undo'))
            },
          })
        }
      })
      .catch((err) => {
        console.error('Failed to update label:', err)
        if (snapshot) useBoardStore.getState().updateLabel(labelId, snapshot)
        toast('Failed to update label')
      })
  }, [projectId])

  const handleLabelDelete = useCallback((labelId: string) => {
    const snapshot = useBoardStore.getState().labels.find(l => l.id === labelId)
    useBoardStore.getState().removeLabel(labelId)
    deleteLabel(labelId, projectId)
      .then(() => {
        if (snapshot) {
          const frozen = { ...snapshot }
          toast('Label deleted', {
            onUndo: () => {
              useBoardStore.getState().addLabel(frozen)
              createLabel(frozen).catch(() => toast('Failed to restore label'))
            },
          })
        }
      })
      .catch((err) => {
        console.error('Failed to delete label:', err)
        if (snapshot) useBoardStore.getState().addLabel(snapshot)
        toast('Failed to delete label')
      })
  }, [projectId])

  const handleLabelToggle = useCallback((taskId: string, labelId: string, action: 'add' | 'remove') => {
    if (action === 'add') {
      addLabelToTask(taskId, labelId, projectId)
        .then(() => {
          toast('Label added', {
            onUndo: () => {
              const task = useBoardStore.getState().tasks.find(t => t.id === taskId)
              if (task) useBoardStore.getState().updateTask(taskId, { labels: task.labels.filter(l => l !== labelId) })
              removeLabelFromTask(taskId, labelId, projectId).catch(() => toast('Failed to undo'))
            },
          })
        })
        .catch((err) => {
          console.error('Failed to add label:', err)
          const task = useBoardStore.getState().tasks.find(t => t.id === taskId)
          if (task) useBoardStore.getState().updateTask(taskId, { labels: task.labels.filter(l => l !== labelId) })
          toast('Failed to add label')
        })
    } else {
      removeLabelFromTask(taskId, labelId, projectId)
        .then(() => {
          toast('Label removed', {
            onUndo: () => {
              const task = useBoardStore.getState().tasks.find(t => t.id === taskId)
              if (task) useBoardStore.getState().updateTask(taskId, { labels: [...task.labels, labelId] })
              addLabelToTask(taskId, labelId, projectId).catch(() => toast('Failed to undo'))
            },
          })
        })
        .catch((err) => {
          console.error('Failed to remove label:', err)
          const task = useBoardStore.getState().tasks.find(t => t.id === taskId)
          if (task) useBoardStore.getState().updateTask(taskId, { labels: [...task.labels, labelId] })
          toast('Failed to remove label')
        })
    }
  }, [projectId])

  return {
    handleLabelCreate,
    handleLabelUpdate,
    handleLabelDelete,
    handleLabelToggle,
  }
}
