'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import type { ChecklistItem, CheckState, ChecklistStatus } from './checklist'
import { generateId } from '@/lib/utils/colors'
import { toast } from '@/components/ui/Toast'
import { getChecklistItems, createChecklistItem, updateChecklistItem, deleteChecklistItem, renameChecklistGroup, reorderChecklistItems, deleteChecklistGroup } from '@/lib/actions/checklist'
import { useBoardStore } from '@/lib/store/boardStore'

function computeSummary(items: ChecklistItem[]) {
  return {
    total: items.length,
    checked: items.filter((i) => i.state === 'checked').length,
    crossed: items.filter((i) => i.state === 'crossed').length,
  }
}

export function useChecklistHandlers(editingTaskId: string | null, projectId: string) {
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const itemsRef = useRef(checklistItems)
  useEffect(() => { itemsRef.current = checklistItems }, [checklistItems])

  // Becomes true once the real items (with real ids) have loaded. Until then
  // the list is seeded from the store preview for instant display, and
  // mutations are gated off so they can't fire against synthetic preview ids.
  const hydratedRef = useRef(false)

  const syncSummary = useCallback((items: ChecklistItem[]) => {
    if (!editingTaskId) { return }
    useBoardStore.getState().updateChecklistSummary(editingTaskId, computeSummary(items))
  }, [editingTaskId])

  useEffect(() => {
    hydratedRef.current = false
    if (!editingTaskId) {
      setChecklistItems([])
      return
    }
    // Seed instantly from the store preview so the items paint on the same
    // frame the modal opens — no empty-then-pop while the fetch is in flight.
    // Seeded rows carry synthetic ids and stay non-interactive (hydratedRef)
    // until the real items arrive a moment later.
    const preview = useBoardStore.getState().checklistPreviews[editingTaskId]
    setChecklistItems(
      preview && preview.length > 0
        ? preview.map((p, idx) => ({
            id: `__preview_${idx}`,
            title: p.title,
            completed: p.state === 'checked',
            state: (p.state as CheckState) ?? 'unchecked',
            status: null,
            groupName: p.groupName ?? 'Checklist',
          }))
        : []
    )
    let cancelled = false
    getChecklistItems(editingTaskId, projectId)
      .then((items) => {
        if (cancelled) return
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
        hydratedRef.current = true
      })
      .catch(() => { if (!cancelled) { setChecklistItems([]); hydratedRef.current = true } })
    return () => { cancelled = true }
  }, [editingTaskId, projectId])

  const handleChecklistAdd = useCallback((title: string, groupName: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const newItem: ChecklistItem = {
      id: generateId(),
      title,
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    const next = [...checklistItems, newItem]
    setChecklistItems(next)
    syncSummary(next)
    // Omit orderIndex — let the DB transaction assign MAX(orderIndex)+1 globally.
    // Group-local indices were colliding across groups, scrambling order on reopen.
    createChecklistItem({
      id: newItem.id,
      taskId: editingTaskId,
      projectId,
      title,
      groupName,
    }).catch(() => {
      setChecklistItems((prev) => prev.filter((i) => i.id !== newItem.id))
      toast('Checklist item too long — keep it under 2000 characters')
    })
  }, [editingTaskId, checklistItems, projectId, syncSummary])

  const handleChecklistToggle = useCallback((itemId: string, newState: CheckState) => {
    if (!editingTaskId || !hydratedRef.current) return
    const next = checklistItems.map((i) => (i.id === itemId ? { ...i, state: newState, completed: newState === 'checked' } : i))
    setChecklistItems(next)
    syncSummary(next)
    updateChecklistItem(itemId, editingTaskId, projectId, { state: newState }).catch(() => {})
  }, [editingTaskId, projectId, checklistItems, syncSummary])

  const handleChecklistStatusChange = useCallback((itemId: string, status: ChecklistStatus) => {
    if (!editingTaskId || !hydratedRef.current) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status } : i))
    )
    updateChecklistItem(itemId, editingTaskId, projectId, { status }).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const next = checklistItems.filter((i) => i.id !== itemId)
    setChecklistItems(next)
    syncSummary(next)
    deleteChecklistItem(itemId, editingTaskId, projectId).catch(() => {})
  }, [editingTaskId, projectId, checklistItems, syncSummary])

  const handleGroupAdd = useCallback((groupName: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const placeholder: ChecklistItem = {
      id: generateId(),
      title: 'New item',
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    setChecklistItems((prev) => [...prev, placeholder])
    // Omit orderIndex — DB assigns MAX+1 so the new group lands at global end.
    createChecklistItem({
      id: placeholder.id,
      taskId: editingTaskId,
      projectId,
      title: placeholder.title,
      groupName,
    }).catch(() => {
      setChecklistItems((prev) => prev.filter((i) => i.id !== placeholder.id))
      toast('Failed to add checklist group')
    })
  }, [editingTaskId, projectId])

  const handleItemTitleChange = useCallback((itemId: string, title: string) => {
    if (!editingTaskId || !hydratedRef.current) return
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
    if (!editingTaskId || !hydratedRef.current) return
    setChecklistItems((prev) =>
      prev.map((i) => (i.groupName === oldName ? { ...i, groupName: newName } : i))
    )
    renameChecklistGroup(editingTaskId, projectId, oldName, newName).catch(() => {})
  }, [editingTaskId, projectId])

  const handleChecklistReorder = useCallback((orderedItems: { id: string; groupName: string }[]) => {
    if (!editingTaskId || !hydratedRef.current) return
    // `orderedItems` is the full item set in its new on-screen order, each tagged
    // with its (possibly changed) group. We persist global sequential indices plus
    // the group so an item dragged across checklists lands — and stays — put.
    const byId = new Map(itemsRef.current.map((i) => [i.id, i]))
    const newItems = orderedItems
      .map((o) => {
        const it = byId.get(o.id)
        return it ? { ...it, groupName: o.groupName } : null
      })
      .filter((i): i is ChecklistItem => i !== null)
    if (newItems.length === 0) return
    setChecklistItems(newItems)
    const updates = newItems.map((item, idx) => ({ id: item.id, orderIndex: idx, groupName: item.groupName }))
    reorderChecklistItems(editingTaskId, projectId, updates).catch(() => {})
  }, [editingTaskId, projectId])

  const handleGroupDelete = useCallback((groupName: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const removedItems = checklistItems.filter((i) => i.groupName === groupName)
    const next = checklistItems.filter((i) => i.groupName !== groupName)
    setChecklistItems(next)
    syncSummary(next)
    deleteChecklistGroup(editingTaskId, projectId, groupName).catch(() => {
      setChecklistItems((prev) => [...prev, ...removedItems])
      toast('Failed to delete checklist group')
    })
  }, [editingTaskId, projectId, checklistItems, syncSummary])

  const handleGroupReorder = useCallback((orderedGroups: string[]) => {
    if (!editingTaskId || !hydratedRef.current) return
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
      const groupItems = itemsRef.current.filter((i) => i.groupName === gn)
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
