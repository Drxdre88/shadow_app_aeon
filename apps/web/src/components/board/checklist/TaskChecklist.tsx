'use client'

import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { toast } from '@/components/ui/Toast'
import { SortableGroupSection } from './SortableGroupSection'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'

interface TaskChecklistProps {
  taskId: string
  items: ChecklistItem[]
  autoFocusAdd?: boolean
  onItemAdd?: (title: string, groupName: string) => void
  onItemToggle?: (itemId: string, newState: CheckState) => void
  onItemRemove?: (itemId: string) => void
  onItemStatusChange?: (itemId: string, status: ChecklistStatus) => void
  onItemTitleChange?: (itemId: string, title: string) => void
  onGroupRename?: (oldName: string, newName: string) => void
  onGroupAdd?: (groupName: string) => void
  onGroupDelete?: (groupName: string) => void
  onItemReorder?: (reorderedIds: { id: string; orderIndex: number }[]) => void
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
  onGroupAdd,
  onGroupDelete,
  onItemReorder,
  onGroupReorder,
}: TaskChecklistProps) {
  const [addingInGroup, setAddingInGroup] = useState<string | null>(null)
  const [newItemTitle, setNewItemTitle] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemTitle, setEditingItemTitle] = useState('')
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null)
  const [editingGroupValue, setEditingGroupValue] = useState('')
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null)
  const [pendingGroups, setPendingGroups] = useState<string[]>([])

  const groups = Array.from(new Set(items.map((i) => i.groupName)))
  const mergedGroups = [...groups, ...pendingGroups.filter((pg) => !groups.includes(pg))]

  useEffect(() => {
    if (!autoFocusAdd) return
    const firstGroup = groups[0] || 'Checklist'
    const timer = setTimeout(() => {
      setAddingInGroup(firstGroup)
      setNewItemTitle('')
    }, 200)
    return () => clearTimeout(timer)
  }, [])

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

  const handleAddItem = (e: React.FormEvent, groupName: string) => {
    e.preventDefault()
    const trimmed = newItemTitle.trim()
    if (!trimmed || trimmed.length > TITLE_MAX) return
    onItemAdd?.(trimmed, groupName)
    setPendingGroups((prev) => prev.filter((pg) => pg !== groupName))
    setNewItemTitle('')
    setAddingInGroup(groupName)
  }

  const handleAddGroup = () => {
    let idx = displayGroups.length + 1
    let name = `Checklist ${idx}`
    while (displayGroups.includes(name)) {
      idx++
      name = `Checklist ${idx}`
    }
    setPendingGroups((prev) => [...prev, name])
    setAddingInGroup(name)
    setNewItemTitle('')
  }

  const commitItemEdit = () => {
    if (!editingItemId) return
    const trimmed = editingItemTitle.trim()
    if (trimmed && trimmed !== items.find((i) => i.id === editingItemId)?.title) {
      onItemTitleChange?.(editingItemId, trimmed)
    }
    setEditingItemId(null)
    setEditingItemTitle('')
  }

  const commitGroupRename = () => {
    if (!editingGroupName) return
    const trimmed = editingGroupValue.trim()
    if (trimmed && trimmed !== editingGroupName) {
      onGroupRename?.(editingGroupName, trimmed)
    }
    setEditingGroupName(null)
    setEditingGroupValue('')
  }

  const handleDragEnd = (event: DragEndEvent, groupName: string) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const groupItems = items.filter((i) => i.groupName === groupName)
    const oldIndex = groupItems.findIndex((i) => i.id === active.id)
    const newIndex = groupItems.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(groupItems, oldIndex, newIndex)
    const updates = reordered.map((item, idx) => ({ id: item.id, orderIndex: idx }))
    onItemReorder?.(updates)
  }

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = groups.findIndex((g) => g === active.id)
    const newIndex = groups.findIndex((g) => g === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(groups, oldIndex, newIndex)
    onGroupReorder?.(reordered)
  }

  const displayGroups = mergedGroups.length === 0 ? ['Checklist'] : mergedGroups

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGroupDragEnd}
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
              sensors={sensors}
              onToggleCollapse={() => toggleGroup(groupName)}
              onEditGroupStart={() => { setEditingGroupName(groupName); setEditingGroupValue(groupName) }}
              onEditGroupChange={setEditingGroupValue}
              onEditGroupCommit={commitGroupRename}
              onEditGroupCancel={() => { setEditingGroupName(null); setEditingGroupValue('') }}
              onDeleteStart={() => setConfirmDeleteGroup(groupName)}
              onDeleteConfirm={() => { onGroupDelete?.(groupName); setConfirmDeleteGroup(null) }}
              onDeleteCancel={() => setConfirmDeleteGroup(null)}
              onItemToggle={(id, state) => onItemToggle?.(id, state)}
              onItemRemove={(id) => onItemRemove?.(id)}
              onItemStatusChange={(id, status) => onItemStatusChange?.(id, status)}
              onItemEditStart={(id, title) => { setEditingItemId(id); setEditingItemTitle(title) }}
              onItemEditCommit={commitItemEdit}
              onItemEditCancel={() => { setEditingItemId(null); setEditingItemTitle('') }}
              onItemEditTitleChange={setEditingItemTitle}
              onItemDragEnd={(event) => handleDragEnd(event, groupName)}
              onAddStart={() => { setAddingInGroup(groupName); setNewItemTitle('') }}
              onAddChange={setNewItemTitle}
              onAddSubmit={(e) => handleAddItem(e, groupName)}
              onAddCancel={() => { setAddingInGroup(null); setNewItemTitle('') }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        onClick={handleAddGroup}
        className="flex items-center gap-1 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
        title="Add checklist"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  )
}
