'use client'

import { useCallback } from 'react'
import { createLabel, updateLabel, deleteLabel, addLabelToTask, removeLabelFromTask } from '@/lib/actions/labels'

export function useLabelHandlers(projectId: string) {
  const handleLabelCreate = useCallback((label: { id: string; projectId: string; name: string; color: string }) => {
    createLabel(label).catch((err) => console.error('Failed to create label:', err))
  }, [])

  const handleLabelUpdate = useCallback((labelId: string, updates: { name?: string; color?: string }) => {
    updateLabel(labelId, projectId, updates).catch((err) => console.error('Failed to update label:', err))
  }, [projectId])

  const handleLabelDelete = useCallback((labelId: string) => {
    deleteLabel(labelId, projectId).catch((err) => console.error('Failed to delete label:', err))
  }, [projectId])

  const handleLabelToggle = useCallback((taskId: string, labelId: string, action: 'add' | 'remove') => {
    if (action === 'add') {
      addLabelToTask(taskId, labelId, projectId).catch((err) => console.error('Failed to add label:', err))
    } else {
      removeLabelFromTask(taskId, labelId, projectId).catch((err) => console.error('Failed to remove label:', err))
    }
  }, [projectId])

  return {
    handleLabelCreate,
    handleLabelUpdate,
    handleLabelDelete,
    handleLabelToggle,
  }
}
