'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
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
import { SortableGroupSection } from './SortableGroupSection'
import type { ChecklistItem, CheckState, ChecklistStatus } from './types'

interface TaskChecklistProps {
  taskId: string
  items: ChecklistItem[]
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
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemTitle, setEditingItemTitle] = useState('')
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null)
  const [editingGroupValue, setEditingGroupValue] = useState('')
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<string | null>(null)

  const groups = Array.from(new Set(items.map((i) => i.groupName)))

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
    setNewItemTitle('')
    setAddingInGroup(groupName)
  }

  const handleAddGroup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    const name = newGroupName.trim()
    onGroupAdd?.(name)
    setNewGroupName('')
    setAddingGroup(false)
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

  if (groups.length === 0) groups.push('Checklist')

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGroupDragEnd}
      >
        <SortableContext items={groups} strategy={verticalListSortingStrategy}>
          {groups.map((groupName) => (
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
              onItemTitleChange={(id, title) => onItemTitleChange?.(id, title)}
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

      {addingGroup ? (
        <motion.form
          onSubmit={handleAddGroup}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName('') } }}
            onBlur={() => { if (!newGroupName.trim()) { setAddingGroup(false); setNewGroupName('') } }}
            placeholder="Checklist name..."
            className={cn(
              'flex-1 px-3 py-1.5 rounded-md text-sm',
              'bg-white/5 border border-white/10',
              'text-white placeholder-slate-500',
              'focus:outline-none focus:ring-1 focus:ring-white/20'
            )}
            autoFocus
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!newGroupName.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary) 15%, transparent)',
              borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
              border: '1px solid',
              color: 'var(--primary)',
            }}
          >
            Add
          </button>
        </motion.form>
      ) : (
        <button
          onClick={() => { setAddingGroup(true); setNewGroupName('') }}
          className="flex items-center gap-1 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
          title="Add checklist"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
