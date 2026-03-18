'use client'

import { useCallback } from 'react'
import { addTaskDependency, removeTaskDependency } from '@/lib/actions/dependencies'
import { useBoardStore } from '@/lib/store/boardStore'

export function useDependencyHandlers(projectId: string) {
  const { addDependency, removeDependency } = useBoardStore()

  const handleAddDependency = useCallback((blockerTaskId: string, blockedTaskId: string) => {
    addDependency({ blockerTaskId, blockedTaskId })
    addTaskDependency(projectId, blockerTaskId, blockedTaskId).catch((err) => {
      console.error('Failed to add dependency:', err)
      removeDependency(blockerTaskId, blockedTaskId)
    })
  }, [projectId, addDependency, removeDependency])

  const handleRemoveDependency = useCallback((blockerTaskId: string, blockedTaskId: string) => {
    removeDependency(blockerTaskId, blockedTaskId)
    removeTaskDependency(projectId, blockerTaskId, blockedTaskId).catch((err) =>
      console.error('Failed to remove dependency:', err)
    )
  }, [projectId, removeDependency])

  return {
    handleAddDependency,
    handleRemoveDependency,
  }
}
