'use client'

import { useCallback, useState, useEffect } from 'react'
import type { ChecklistItem, CheckState, ChecklistStatus } from './checklist'
import { generateId } from '@/lib/utils/colors'
import { toast } from '@/components/ui/Toast'
import { getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem, renameChecklistGroup, reorderChecklistItems, deleteChecklistGroup } from '@/lib/actions/checklist'

export function useChecklistHandlers(editingTaskId: string | null, projectId: string) {
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])

  useEffect(() => {
    if (!editingTaskId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecklistItems([])
      return
    }
    getChecklistItems(editingTaskId, projectId)
      .then((items) =>
         
        setChecklistItems(
          items.map((i) => ({
            id: i.id,
            title: i.title,
            completed: i.completed,
            state: (i.state as CheckState) ?? (i.completed ? 'checked' : 'unchecked'),
            status: (i.status as ChecklistStatus) ?? null,
            groupName: i.groupName ?? 'Checklist',
            startDate: i.startDate ? i.startDate.toISOString() : undefined,
            endDate: i.endDate ? i.endDate.toISOString() : undefined,
          }))
        )
      )
       
      .catch(() => setChecklistItems([]))
  }, [editingTaskId, projectId])

  const handleChecklistAdd = useCallback((title: string, groupName: string) => {
    if (!editingTaskId) return
    const groupItems = checklistItems.filter((i) => i.groupName === groupName)
    const newItem: ChecklistItem = {
      id: generateId(),
      title,
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    setChecklistItems((prev) => [...prev, newItem])
    createChecklistItem({
      id: newItem.id,
      taskId: editingTaskId,
      projectId,
      title,
      orderIndex: groupItems.length,
      groupName,
    }).catch(() => {
      setChecklistItems((prev) => prev.filter((i) => i.id !== newItem.id))
      toast('Checklist item too long — keep it under 2000 characters')
    })
  }, [editingTaskId, checklistItems, projectId])

  const handleChecklistToggle = useCallback((itemId: string, newState: CheckState) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, state: newState, completed: newState === 'checked' } : i))
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { state: newState }).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistStatusChange = useCallback((itemId: string, status: ChecklistStatus) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status } : i))
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { status }).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTaskId) return
    setChecklistItems((prev) => prev.filter((i) => i.id !== itemId))
    deleteChecklistItem(itemId, editingTaskId, projectId).catch(() => {})
  }, [editingTaskId, projectId])

  const handleGroupAdd = useCallback((groupName: string) => {
    if (!editingTaskId) return
    const placeholder: ChecklistItem = {
      id: generateId(),
      title: 'New item',
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    setChecklistItems((prev) => [...prev, placeholder])
    createChecklistItem({
      id: placeholder.id,
      taskId: editingTaskId,
      projectId,
      title: placeholder.title,
      orderIndex: 0,
      groupName,
    }).catch(() => {
      setChecklistItems((prev) => prev.filter((i) => i.id !== placeholder.id))
      toast('Failed to add checklist group')
    })
  }, [editingTaskId, projectId])

  const handleItemTitleChange = useCallback((itemId: string, title: string) => {
    if (!editingTaskId) return
    let prevTitle: string | undefined
    setChecklistItems((prev) =>
      prev.map((i) => {
        if (i.id === itemId) {
          prevTitle = i.title
          return { ...i, title }
        }
        return i
      })
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { title }).catch(() => {
      setChecklistItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, title: prevTitle ?? i.title } : i))
      )
      toast('Checklist item too long — keep it under 2000 characters')
    })
  }, [editingTaskId, projectId])

  const handleGroupRename = useCallback((oldName: string, newName: string) => {
    if (!editingTaskId) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.groupName === oldName ? { ...i, groupName: newName } : i))
    )
    renameChecklistGroup(editingTaskId, projectId, oldName, newName).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistReorder = useCallback((updates: { id: string; orderIndex: number }[]) => {
    if (!editingTaskId) return
    const orderMap = new Map(updates.map((u) => [u.id, u.orderIndex]))
    setChecklistItems((prev) => {
      const grouped = new Map<string, ChecklistItem[]>()
      for (const item of prev) {
        const g = grouped.get(item.groupName) ?? []
        g.push(item)
        grouped.set(item.groupName, g)
      }
      for (const [, group] of grouped) {
        group.sort((a, b) => {
          const ai = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity
          const bi = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity
          return ai - bi
        })
      }
      return Array.from(grouped.values()).flat()
    })
    reorderChecklistItems(editingTaskId, projectId, updates).catch(() => {})
  }, [editingTaskId, projectId])

  const handleGroupDelete = useCallback((groupName: string) => {
    if (!editingTaskId) return
    const removedItems = checklistItems.filter((i) => i.groupName === groupName)
    setChecklistItems((prev) => prev.filter((i) => i.groupName !== groupName))
    deleteChecklistGroup(editingTaskId, projectId, groupName).catch(() => {
      setChecklistItems((prev) => [...prev, ...removedItems])
      toast('Failed to delete checklist group')
    })
  }, [editingTaskId, projectId, checklistItems])

  const handleGroupReorder = useCallback((orderedGroups: string[]) => {
    if (!editingTaskId) return
    setChecklistItems((prev) => {
      const grouped = new Map<string, ChecklistItem[]>()
      for (const item of prev) {
        const g = grouped.get(item.groupName) ?? []
        g.push(item)
        grouped.set(item.groupName, g)
      }
      const reordered: ChecklistItem[] = []
      for (const gn of orderedGroups) {
        const g = grouped.get(gn)
        if (g) reordered.push(...g)
      }
      return reordered
    })
    const updates: { id: string; orderIndex: number }[] = []
    let idx = 0
    for (const gn of orderedGroups) {
      const groupItems = checklistItems.filter((i) => i.groupName === gn)
      for (const item of groupItems) {
        updates.push({ id: item.id, orderIndex: idx++ })
      }
    }
    if (updates.length > 0) {
      reorderChecklistItems(editingTaskId, projectId, updates).catch(() => {})
    }
  }, [editingTaskId, projectId, checklistItems])

  return {
    checklistItems,
    handleChecklistAdd,
    handleChecklistToggle,
    handleChecklistStatusChange,
    handleChecklistRemove,
    handleGroupAdd,
    handleItemTitleChange,
    handleGroupRename,
    handleChecklistReorder,
    handleGroupDelete,
    handleGroupReorder,
  }
}
