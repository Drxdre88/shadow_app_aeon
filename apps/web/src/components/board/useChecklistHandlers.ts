'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import type { ChecklistItem, CheckState, ChecklistStatus } from './checklist'
import { arrangeItemAdd } from './checklist/groupOrder'
import { generateId } from '@/lib/utils/colors'
import { getChecklistItems } from '@/lib/actions/checklist'
import { useBoardStore } from '@/lib/store/boardStore'
import { useMutationQueue } from '@/lib/store/mutationQueue'
import type { QueuedMutation } from '@/lib/store/mutationDispatch'

function computeSummary(items: ChecklistItem[]) {
  return {
    total: items.length,
    checked: items.filter((i) => i.state === 'checked').length,
    crossed: items.filter((i) => i.state === 'crossed').length,
  }
}

// Overlays still-queued checklist mutations for this task onto the freshly
// fetched server list. Without this, reopening a card while its writes are
// queued (offline / retrying) makes the just-made edits vanish from view —
// the exact symptom class this hook exists to prevent. Reorders are skipped:
// transient order drift on reopen is harmless and self-heals on flush.
function applyQueuedMutations(taskId: string, items: ChecklistItem[]): ChecklistItem[] {
  let out = items
  for (const m of useMutationQueue.getState().pending) {
    switch (m.type) {
      case 'checklist.create':
        if (m.args.taskId === taskId && !out.some((i) => i.id === m.args.itemId)) {
          out = [...out, {
            id: m.args.itemId,
            title: m.args.title,
            completed: false,
            state: 'unchecked' as CheckState,
            status: null,
            groupName: m.args.groupName,
          }]
        }
        break
      case 'checklist.update':
        if (m.args.taskId === taskId) {
          const u = m.args.updates
          out = out.map((i) => (i.id === m.args.itemId
            ? {
                ...i,
                ...(u.title !== undefined ? { title: u.title } : {}),
                ...(u.state !== undefined ? { state: u.state as CheckState, completed: u.state === 'checked' } : {}),
                ...(u.status !== undefined ? { status: u.status as ChecklistStatus } : {}),
              }
            : i))
        }
        break
      case 'checklist.delete':
        if (m.args.taskId === taskId) out = out.filter((i) => i.id !== m.args.itemId)
        break
      case 'checklist.groupRename':
        if (m.args.taskId === taskId) {
          const { oldName, newName } = m.args
          out = out.map((i) => (i.groupName === oldName ? { ...i, groupName: newName } : i))
        }
        break
      case 'checklist.groupDelete':
        if (m.args.taskId === taskId) out = out.filter((i) => i.groupName !== m.args.groupName)
        break
      default:
        break
    }
  }
  return out
}

export function useChecklistHandlers(editingTaskId: string | null, projectId: string) {
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const itemsRef = useRef(checklistItems)
  useEffect(() => { itemsRef.current = checklistItems }, [checklistItems])
  const editingTaskIdRef = useRef(editingTaskId)

  // Becomes true once the real items (with real ids) have loaded. Until then
  // the list is seeded from the store preview for instant display, and
  // mutations are gated off so they can't fire against synthetic preview ids.
  const hydratedRef = useRef(false)

  const syncSummary = useCallback((items: ChecklistItem[]) => {
    if (!editingTaskId) { return }
    useBoardStore.getState().updateChecklistSummary(editingTaskId, computeSummary(items))
  }, [editingTaskId])

  // All checklist writes go through the durable mutation queue — same
  // retry/rollback/toast/offline-replay path as task writes. The queue is
  // FIFO, so a checklist write enqueued after its parent task.create can
  // never race ahead of it.
  const enqueue = useCallback((
    mutation: QueuedMutation,
    rollback: () => void,
    failMessage: string,
  ) => {
    useMutationQueue.getState().enqueue(mutation, { rollback, failMessage })
  }, [])

  // Rollbacks fire seconds after enqueue — the modal may have closed or moved
  // to another task by then. The snapshot is captured at enqueue time (never
  // read live at rollback time), the list is only touched if this task is
  // still the open one, and the card-face summary is always reverted.
  const rollbackToSnapshot = useCallback((taskId: string, snapshot: ChecklistItem[]) => {
    if (editingTaskIdRef.current === taskId) setChecklistItems(snapshot)
    useBoardStore.getState().updateChecklistSummary(taskId, computeSummary(snapshot))
  }, [])

  useEffect(() => {
    editingTaskIdRef.current = editingTaskId
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
        setChecklistItems(applyQueuedMutations(editingTaskId, items.map((i) => ({
          id: i.id,
          title: i.title,
          completed: i.completed,
          state: (i.state as CheckState) ?? (i.completed ? 'checked' : 'unchecked'),
          status: (i.status as ChecklistStatus) ?? null,
          groupName: i.groupName ?? 'Checklist',
          startDate: i.startDate ? i.startDate.toISOString() : undefined,
          endDate: i.endDate ? i.endDate.toISOString() : undefined,
        }))))
        hydratedRef.current = true
      })
      .catch(() => { if (!cancelled) { setChecklistItems([]); hydratedRef.current = true } })
    return () => { cancelled = true }
  }, [editingTaskId, projectId])

  // Returns false when the add could not be accepted (modal still hydrating) —
  // the caller must keep the typed text in the input instead of clearing it.
  // `orderedGroups` is the on-screen group order (including still-empty ghost
  // groups) so the persisted orderIndex sequence matches what the user sees.
  const handleChecklistAdd = useCallback((title: string, groupName: string, orderedGroups?: string[]): boolean => {
    if (!editingTaskId || !hydratedRef.current) return false
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    const newItem: ChecklistItem = {
      id: generateId(),
      title,
      completed: false,
      state: 'unchecked',
      status: null,
      groupName,
    }
    const { next, reindex } = arrangeItemAdd(snapshot, newItem, orderedGroups)
    setChecklistItems(next)
    syncSummary(next)
    // Omit orderIndex — let the DB transaction assign MAX(orderIndex)+1 globally.
    // Group-local indices were colliding across groups, scrambling order on reopen.
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.create',
        args: { itemId: newItem.id, taskId, projectId, title, groupName },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not add checklist item — reverted',
    )
    // When the item's on-screen position is not the global end (its group sits
    // above other groups' items), follow the append with a full contiguous
    // rewrite in display order — otherwise the group order derived from
    // orderIndex on reload would differ from what the user arranged. The queue
    // is FIFO, so the create always lands before this reorder.
    if (reindex) {
      enqueue(
        {
          id: crypto.randomUUID(),
          type: 'checklist.reorder',
          args: { taskId, projectId, updates: reindex },
        },
        () => rollbackToSnapshot(taskId, snapshot),
        'Could not reorder checklist — reverted',
      )
    }
    return true
  }, [editingTaskId, projectId, syncSummary, enqueue, rollbackToSnapshot])

  const handleChecklistToggle = useCallback((itemId: string, newState: CheckState) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    if (!snapshot.some((i) => i.id === itemId)) return
    const next = snapshot.map((i) => (i.id === itemId ? { ...i, state: newState, completed: newState === 'checked' } : i))
    setChecklistItems(next)
    syncSummary(next)
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.update',
        args: { itemId, taskId, projectId, updates: { state: newState } },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not save checklist — reverted',
    )
  }, [editingTaskId, projectId, syncSummary, enqueue, rollbackToSnapshot])

  const handleChecklistStatusChange = useCallback((itemId: string, status: ChecklistStatus) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    setChecklistItems(snapshot.map((i) => (i.id === itemId ? { ...i, status } : i)))
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.update',
        args: { itemId, taskId, projectId, updates: { status } },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not save checklist — reverted',
    )
  }, [editingTaskId, projectId, enqueue, rollbackToSnapshot])

  const handleChecklistRemove = useCallback((itemId: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    const next = snapshot.filter((i) => i.id !== itemId)
    setChecklistItems(next)
    syncSummary(next)
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.delete',
        args: { itemId, taskId, projectId },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not delete checklist item — restored',
    )
  }, [editingTaskId, projectId, syncSummary, enqueue, rollbackToSnapshot])

  const handleItemTitleChange = useCallback((itemId: string, title: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    setChecklistItems(snapshot.map((i) => (i.id === itemId ? { ...i, title } : i)))
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.update',
        args: { itemId, taskId, projectId, updates: { title } },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not save checklist item — reverted',
    )
  }, [editingTaskId, projectId, enqueue, rollbackToSnapshot])

  const handleGroupRename = useCallback((oldName: string, newName: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    setChecklistItems(snapshot.map((i) => (i.groupName === oldName ? { ...i, groupName: newName } : i)))
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.groupRename',
        args: { taskId, projectId, oldName, newName },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not rename checklist — reverted',
    )
  }, [editingTaskId, projectId, enqueue, rollbackToSnapshot])

  const handleChecklistReorder = useCallback((orderedItems: { id: string; groupName: string }[]) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    // `orderedItems` is the full item set in its new on-screen order, each tagged
    // with its (possibly changed) group. We persist global sequential indices plus
    // the group so an item dragged across checklists lands — and stays — put.
    const snapshot = itemsRef.current
    const byId = new Map(snapshot.map((i) => [i.id, i]))
    const newItems = orderedItems
      .map((o) => {
        const it = byId.get(o.id)
        return it ? { ...it, groupName: o.groupName } : null
      })
      .filter((i): i is ChecklistItem => i !== null)
    if (newItems.length === 0) return
    setChecklistItems(newItems)
    const updates = newItems.map((item, idx) => ({ id: item.id, orderIndex: idx, groupName: item.groupName }))
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.reorder',
        args: { taskId, projectId, updates },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not reorder checklist — reverted',
    )
  }, [editingTaskId, projectId, enqueue, rollbackToSnapshot])

  const handleGroupDelete = useCallback((groupName: string) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
    const next = snapshot.filter((i) => i.groupName !== groupName)
    setChecklistItems(next)
    syncSummary(next)
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.groupDelete',
        args: { taskId, projectId, groupName },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not delete checklist group — restored',
    )
  }, [editingTaskId, projectId, syncSummary, enqueue, rollbackToSnapshot])

  const handleGroupReorder = useCallback((orderedGroups: string[]) => {
    if (!editingTaskId || !hydratedRef.current) return
    const taskId = editingTaskId
    const snapshot = itemsRef.current
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
      const groupItems = snapshot.filter((i) => i.groupName === gn)
      for (const item of groupItems) {
        updates.push({ id: item.id, orderIndex: idx++ })
      }
    }
    if (updates.length === 0) return
    enqueue(
      {
        id: crypto.randomUUID(),
        type: 'checklist.reorder',
        args: { taskId, projectId, updates },
      },
      () => rollbackToSnapshot(taskId, snapshot),
      'Could not reorder checklist — reverted',
    )
  }, [editingTaskId, projectId, enqueue, rollbackToSnapshot])

  return {
    checklistItems,
    handleChecklistAdd,
    handleChecklistToggle,
    handleChecklistStatusChange,
    handleChecklistRemove,
    handleItemTitleChange,
    handleGroupRename,
    handleChecklistReorder,
    handleGroupDelete,
    handleGroupReorder,
  }
}
