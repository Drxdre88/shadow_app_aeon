'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'
import { SortableGroupSection } from './SortableGroupSection'
import { TriStateCheckbox } from './TriStateCheckbox'
import { arrangeItemAt, arrangeItemDrag } from './reorder'
import { placementForDrag, samePlacement, type DropPlacement } from './dropPlacement'
import { mergeGroupOrder, extendGroupOrderMemory } from './groupOrder'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'

interface TaskChecklistProps {
  taskId: string
  items: ChecklistItem[]
  autoFocusAdd?: boolean
  // Returns false when the add was not accepted (still hydrating) — the typed
  // text must then stay in the input rather than being silently discarded.
  onItemAdd?: (title: string, groupName: string, orderedGroups?: string[]) => boolean | void
  onItemToggle?: (itemId: string, newState: CheckState) => void
  onItemRemove?: (itemId: string) => void
  onItemStatusChange?: (itemId: string, status: ChecklistStatus) => void
  onItemTitleChange?: (itemId: string, title: string) => void
  onGroupRename?: (oldName: string, newName: string) => void
  onGroupDelete?: (groupName: string) => void
  onItemReorder?: (orderedItems: { id: string; groupName: string }[]) => void
  onGroupReorder?: (orderedGroups: string[]) => void
}

export function TaskChecklist({
  taskId,
  items,
  autoFocusAdd,
  onItemAdd,
  onItemToggle,
  onItemRemove,
  onItemStatusChange,
  onItemTitleChange,
  onGroupRename,
  onGroupDelete,
  onItemReorder,
  onGroupReorder,
}: TaskChecklistProps) {
  const [addingInGroup, setAddingInGroup] = useState<string | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const editingItemIdRef = useRef<string | null>(null)
  const [editingItemTitle, setEditingItemTitle] = useState('')
  const editingItemTitleRef = useRef('')
  const itemCommittedRef = useRef(false)
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null)
  const editingGroupNameRef = useRef<string | null>(null)
  const [editingGroupValue, setEditingGroupValue] = useState('')
  const editingGroupValueRef = useRef('')
  const groupCommittedRef = useRef(false)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null)
  const [pendingGroups, setPendingGroups] = useState<string[]>([])
  const [activeDragItemId, setActiveDragItemId] = useState<string | null>(null)
  // Live drop slot for the dragged item: drives the insertion line and is
  // the drop's truth (see placementForDrag).
  const [placement, setPlacement] = useState<DropPlacement | null>(null)
  // Same-frame double-click guard for handleAddGroup. Without this, two
  // clicks fired before React re-renders both see the same displayGroups,
  // compute the same name (e.g. "Checklist 2") and duplicate React keys on render.
  const addingGroupRef = useRef(false)

  // Order memory: the order groups were first displayed this mount, updated by
  // explicit user edits (drag, rename, delete). Display order is memory-first
  // so a group gaining or losing items never changes its slot — deriving order
  // from items alone made empty groups jump when their first item committed.
  const [groupOrder, setGroupOrder] = useState<string[]>([])
  const groups = Array.from(new Set(items.map((i) => i.groupName)))
  const mergedGroups = mergeGroupOrder(groupOrder, groups, pendingGroups)

  const autoFocusedRef = useRef(false)
  useEffect(() => {
    if (!autoFocusAdd || items.length === 0 || autoFocusedRef.current) return
    autoFocusedRef.current = true
    const firstGroup = groups[0] || 'Checklist'
    const timer = setTimeout(() => {
      setAddingInGroupSynced(firstGroup)
      setNewItemTitleSynced('')
    }, 200)
    return () => clearTimeout(timer)
  }, [autoFocusAdd, items.length])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const TITLE_MAX = 2000

  // Commit whatever is typed in the add-item input without an explicit Enter —
  // fired on input blur and on unmount (modal "Done"/close). Before this,
  // typed-but-not-submitted items were silently discarded when the modal closed.
  //
  // The refs are updated SYNCHRONOUSLY in the event handlers below (never
  // during render, never in a passive effect): an Escape or Ctrl+Enter cancels/
  // commits AND unmounts the modal in the same React batch, so an effect-synced
  // ref would still hold the typed text when the unmount cleanup runs — turning
  // a cancel into a commit or a commit into a duplicate.
  const newItemTitleRef = useRef('')
  const addingInGroupRef = useRef<string | null>(null)
  const onItemAddRef = useRef(onItemAdd)
  useEffect(() => { onItemAddRef.current = onItemAdd })
  const setNewItemTitleSynced = (v: string) => { newItemTitleRef.current = v; setNewItemTitle(v) }
  const setAddingInGroupSynced = (g: string | null) => { addingInGroupRef.current = g; setAddingInGroup(g) }

  const handleAddItem = (e: React.FormEvent, groupName: string) => {
    e.preventDefault()
    const trimmed = newItemTitle.trim()
    if (!trimmed || trimmed.length > TITLE_MAX) return
    if (onItemAdd?.(trimmed, groupName, displayGroups) === false) return
    setPendingGroups((prev) => prev.filter((pg) => pg !== groupName))
    setNewItemTitleSynced('')
    setAddingInGroupSynced(groupName)
  }

  const commitPendingAdd = () => {
    const groupName = addingInGroupRef.current
    const trimmed = newItemTitleRef.current.trim()
    if (!groupName || !trimmed || trimmed.length > TITLE_MAX) return
    if (onItemAddRef.current?.(trimmed, groupName, displayGroupsRef.current) === false) return
    setPendingGroups((prev) => prev.filter((pg) => pg !== groupName))
    setNewItemTitleSynced('')
    setAddingInGroupSynced(null)
  }
  const commitPendingAddRef = useRef(commitPendingAdd)
  useEffect(() => { commitPendingAddRef.current = commitPendingAdd })
  useEffect(() => () => { commitPendingAddRef.current() }, [])

  const handleAddGroup = () => {
    if (addingGroupRef.current) return
    addingGroupRef.current = true
    // Release on next paint — single-frame block, no UX impact for normal use.
    requestAnimationFrame(() => { addingGroupRef.current = false })

    let idx = displayGroups.length + 1
    let name = `Checklist ${idx}`
    while (displayGroups.includes(name)) {
      idx++
      name = `Checklist ${idx}`
    }
    // Ghost group: lives only in local state until its first item is
    // committed — escape/blur with nothing typed persists nothing.
    setPendingGroups((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setAddingInGroupSynced(name)
    setNewItemTitleSynced('')
  }

  const commitItemEdit = () => {
    if (itemCommittedRef.current) return
    const currentId = editingItemIdRef.current
    if (!currentId) return
    itemCommittedRef.current = true
    const trimmed = editingItemTitleRef.current.trim()
    if (trimmed) {
      onItemTitleChange?.(currentId, trimmed)
    }
    setEditingItemId(null)
    editingItemIdRef.current = null
    setEditingItemTitle('')
    editingItemTitleRef.current = ''
  }

  const commitGroupRename = () => {
    if (groupCommittedRef.current) return
    const currentName = editingGroupNameRef.current
    if (!currentName) return
    groupCommittedRef.current = true
    const trimmed = editingGroupValueRef.current.trim()
    if (trimmed && trimmed !== currentName) {
      // Rename in place in the order memory (dedupe keeps the earliest slot
      // when renaming merges into an existing group).
      setGroupOrder((prev) => {
        const mapped = prev.map((g) => (g === currentName ? trimmed : g))
        return mapped.filter((g, idx) => mapped.indexOf(g) === idx)
      })
      setPendingGroups((prev) => {
        if (prev.includes(currentName)) {
          return prev.map((pg) => pg === currentName ? trimmed : pg)
        }
        return [...prev, trimmed]
      })
      if (addingInGroupRef.current === currentName) setAddingInGroupSynced(trimmed)
      onGroupRename?.(currentName, trimmed)
    }
    setEditingGroupName(null)
    editingGroupNameRef.current = null
    setEditingGroupValue('')
    editingGroupValueRef.current = ''
  }

  const displayGroups = mergedGroups.length === 0 ? ['Checklist'] : mergedGroups

  // Memorize the rendered order (append-only; guard keeps the same reference
  // when nothing new appeared, so this cannot loop). The ref mirrors the last
  // painted order for ref-based commit paths (blur/unmount commits).
  const displayGroupsRef = useRef<string[]>(displayGroups)
  useEffect(() => {
    displayGroupsRef.current = displayGroups
    setGroupOrder((prev) => extendGroupOrderMemory(prev, mergedGroups))
  })

  const handleDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === 'item') {
      setActiveDragItemId(String(event.active.id))
    }
  }

  const handleDragMove = (event: DragMoveEvent | DragOverEvent) => {
    const next = placementForDrag(items, displayGroups, event)
    setPlacement((prev) => (samePlacement(prev, next) ? prev : next))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragItemId(null)
    setPlacement(null)
    const { active, over } = event
    if (!over) return
    const activeType = active.data.current?.type

    if (activeType === 'group') {
      const overGroup = displayGroups.includes(String(over.id))
        ? String(over.id)
        : items.find((i) => i.id === over.id)?.groupName
      if (!overGroup || overGroup === active.id) return
      const oldIndex = displayGroups.findIndex((g) => g === active.id)
      const newIndex = displayGroups.findIndex((g) => g === overGroup)
      if (oldIndex === -1 || newIndex === -1) return
      const newOrder = arrayMove(displayGroups, oldIndex, newIndex)
      // Rewrite the order memory so the drag sticks even for empty groups
      // (which have no items to encode the new order in).
      setGroupOrder((prev) => [...newOrder, ...prev.filter((g) => !newOrder.includes(g))])
      onGroupReorder?.(newOrder)
      return
    }

    const drop = placementForDrag(items, displayGroups, event) ?? placement
    const arrangement = drop
      ? arrangeItemAt(items, displayGroups, String(active.id), drop.groupName, drop.index)
      : arrangeItemDrag(items, displayGroups, String(active.id), String(over.id))
    if (arrangement) onItemReorder?.(arrangement)
  }

  const activeDragItem = activeDragItemId ? items.find((i) => i.id === activeDragItemId) : null

  return (
    <div className="space-y-4" data-checklist-root>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActiveDragItemId(null); setPlacement(null) }}
      >
        <SortableContext items={displayGroups} strategy={verticalListSortingStrategy}>
          {displayGroups.map((groupName) => (
            <SortableGroupSection
              key={groupName}
              groupName={groupName}
              items={items.filter((i) => i.groupName === groupName)}
              isCollapsed={collapsedGroups.has(groupName)}
              isEditing={editingGroupName === groupName}
              editingGroupValue={editingGroupValue}
              confirmingDelete={confirmDeleteGroup === groupName}
              editingItemId={editingItemId}
              editingItemTitle={editingItemTitle}
              addingInGroup={addingInGroup === groupName}
              newItemTitle={newItemTitle}
              titleMax={TITLE_MAX}
              activeDragItemId={activeDragItemId}
              dropIndex={placement?.groupName === groupName ? placement.index : null}
              onToggleCollapse={() => toggleGroup(groupName)}
              onEditGroupStart={() => { groupCommittedRef.current = false; setEditingGroupName(groupName); editingGroupNameRef.current = groupName; setEditingGroupValue(groupName); editingGroupValueRef.current = groupName }}
              onEditGroupChange={(v: string) => { setEditingGroupValue(v); editingGroupValueRef.current = v }}
              onEditGroupCommit={commitGroupRename}
              onEditGroupCancel={() => { groupCommittedRef.current = false; setEditingGroupName(null); editingGroupNameRef.current = null; setEditingGroupValue(''); editingGroupValueRef.current = '' }}
              onDeleteStart={() => setConfirmDeleteGroup(groupName)}
              onDeleteConfirm={() => { onGroupDelete?.(groupName); setConfirmDeleteGroup(null); setPendingGroups((prev) => prev.filter((pg) => pg !== groupName)); setGroupOrder((prev) => prev.filter((g) => g !== groupName)); if (addingInGroupRef.current === groupName) setAddingInGroupSynced(null) }}
              onDeleteCancel={() => setConfirmDeleteGroup(null)}
              onItemToggle={(id, state) => onItemToggle?.(id, state)}
              onItemRemove={(id) => onItemRemove?.(id)}
              onItemStatusChange={(id, status) => onItemStatusChange?.(id, status)}
              onItemEditStart={(id, title) => { itemCommittedRef.current = false; setEditingItemId(id); editingItemIdRef.current = id; setEditingItemTitle(title); editingItemTitleRef.current = title }}
              onItemEditCommit={commitItemEdit}
              onItemEditCancel={() => { itemCommittedRef.current = false; setEditingItemId(null); editingItemIdRef.current = null; setEditingItemTitle(''); editingItemTitleRef.current = '' }}
              onItemEditTitleChange={(v: string) => { setEditingItemTitle(v); editingItemTitleRef.current = v }}
              onAddStart={() => { setAddingInGroupSynced(groupName); setNewItemTitleSynced('') }}
              onAddChange={setNewItemTitleSynced}
              onAddSubmit={(e) => handleAddItem(e, groupName)}
              onAddCommit={commitPendingAdd}
              onAddCancel={() => { setAddingInGroupSynced(null); setNewItemTitleSynced('') }}
            />
          ))}
        </SortableContext>

        {/* Portaled to the body: the card editor (modal, floating window,
            Zen surface) sits inside backdrop-filter/transform ancestors, which
            turn the overlay's fixed positioning into modal-relative coordinates
            and strand the preview off to the side. */}
        {typeof document !== 'undefined' && createPortal(
        <DragOverlay dropAnimation={null}>
          {activeDragItem ? (
            <div data-checklist-drag-overlay className="flex items-center gap-2 p-2.5 rounded-lg border bg-slate-800/95 border-white/15 shadow-lg shadow-black/50 backdrop-blur-sm">
              <GripVertical className="w-3 h-3 text-slate-500 flex-shrink-0" />
              <TriStateCheckbox state={activeDragItem.state} onClick={() => {}} />
              <span className={cn(
                'text-sm min-w-0 truncate',
                activeDragItem.state === 'checked' && 'line-through text-slate-500',
                activeDragItem.state === 'crossed' && 'line-through text-red-400/50',
                activeDragItem.state === 'unchecked' && 'text-slate-200',
              )}>
                {activeDragItem.title}
              </span>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
        )}
      </DndContext>

      <button
        onClick={handleAddGroup}
        className="flex items-center gap-1 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
        aria-label="Add checklist group"
        title="Add checklist"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}
