'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, X, Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils/cn'

export type CheckState = 'unchecked' | 'checked' | 'crossed'
export type ChecklistStatus = 'live' | 'blocked' | 'awaiting_dev' | null

const STATUS_OPTIONS: { value: ChecklistStatus; label: string; color: string; glow: string }[] = [
  { value: 'live', label: 'Live', color: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30', glow: '0 0 8px rgba(16,185,129,0.4)' },
  { value: 'blocked', label: 'Blocked', color: 'text-red-400 bg-red-500/20 border-red-500/30', glow: '0 0 8px rgba(239,68,68,0.4)' },
  { value: 'awaiting_dev', label: 'Awaiting Dev', color: 'text-amber-400 bg-amber-500/20 border-amber-500/30', glow: '0 0 8px rgba(245,158,11,0.4)' },
  { value: null, label: 'None', color: 'text-slate-400 bg-white/5 border-white/10', glow: 'none' },
]

export interface ChecklistItem {
  id: string
  title: string
  completed: boolean
  state: CheckState
  status: ChecklistStatus
  groupName: string
  startDate?: string
  endDate?: string
}

interface TaskChecklistProps {
  taskId: string
  items: ChecklistItem[]
  onItemAdd?: (title: string, groupName: string) => void
  onItemToggle?: (itemId: string, newState: CheckState) => void
  onItemRemove?: (itemId: string) => void
  onItemStatusChange?: (itemId: string, status: ChecklistStatus) => void
  onItemUpdateDates?: (itemId: string, startDate?: string, endDate?: string) => void
  onItemTitleChange?: (itemId: string, title: string) => void
  onGroupRename?: (oldName: string, newName: string) => void
  onGroupAdd?: (groupName: string) => void
}

function nextState(current: CheckState): CheckState {
  if (current === 'unchecked') return 'checked'
  if (current === 'checked') return 'crossed'
  return 'unchecked'
}

function TriStateCheckbox({ state, onClick }: { state: CheckState; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-300',
        'flex items-center justify-center',
        state === 'checked' && 'bg-emerald-500 border-emerald-400',
        state === 'crossed' && 'bg-red-500 border-red-400',
        state === 'unchecked' && 'border-white/30 hover:border-white/50'
      )}
      style={{
        boxShadow:
          state === 'checked'
            ? '0 0 12px rgba(16,185,129,0.6), 0 0 24px rgba(16,185,129,0.3)'
            : state === 'crossed'
              ? '0 0 12px rgba(239,68,68,0.6), 0 0 24px rgba(239,68,68,0.3)'
              : undefined,
      }}
    >
      {state === 'checked' && <Check className="w-3 h-3 text-white drop-shadow-[0_0_4px_rgba(16,185,129,0.8)]" />}
      {state === 'crossed' && <X className="w-3 h-3 text-white drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]" />}
    </button>
  )
}

function StatusBadge({
  status,
  onStatusChange,
}: {
  status: ChecklistStatus
  onStatusChange: (s: ChecklistStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const current = STATUS_OPTIONS.find((o) => o.value === status) ?? STATUS_OPTIONS[3]

  if (!status && !open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="px-1.5 py-0.5 rounded text-[10px] text-slate-600 hover:text-slate-400 hover:bg-white/5 transition-all opacity-0 group-hover:opacity-100"
      >
        status
      </button>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={cn(
          'px-2 py-0.5 rounded-md text-[10px] font-medium border transition-all',
          current.color
        )}
        style={{ boxShadow: current.glow }}
      >
        {current.label}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-black/90 backdrop-blur-xl border border-white/10 rounded-lg p-1 min-w-[120px] shadow-xl">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                onClick={(e) => {
                  e.stopPropagation()
                  onStatusChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'w-full px-3 py-1.5 rounded-md text-xs text-left transition-all',
                  'hover:bg-white/10',
                  status === opt.value ? 'text-white' : 'text-slate-400'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function TaskChecklist({
  taskId,
  items,
  onItemAdd,
  onItemToggle,
  onItemRemove,
  onItemStatusChange,
  onItemUpdateDates,
  onItemTitleChange,
  onGroupRename,
  onGroupAdd,
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

  const groups = Array.from(new Set(items.map((i) => i.groupName)))
  const hasNoItems = items.length === 0
  const defaultGroup = groups.length > 0 ? groups[0] : 'Checklist'

  useEffect(() => {
    if (hasNoItems && !addingInGroup) {
      setAddingInGroup(defaultGroup)
      setNewItemTitle('')
    }
  }, [hasNoItems])

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleAddItem = (e: React.FormEvent, groupName: string) => {
    e.preventDefault()
    if (!newItemTitle.trim()) return
    onItemAdd?.(newItemTitle.trim(), groupName)
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

  if (groups.length === 0) groups.push('Checklist')

  return (
    <div className="space-y-4">
      {groups.map((groupName) => {
        const groupItems = items.filter((i) => i.groupName === groupName)
        const checkedCount = groupItems.filter((i) => i.state === 'checked').length
        const crossedCount = groupItems.filter((i) => i.state === 'crossed').length
        const total = groupItems.length
        const progress = total > 0 ? (checkedCount / total) * 100 : 0
        const isCollapsed = collapsedGroups.has(groupName)

        return (
          <div key={groupName} className="space-y-2">
            <div className="flex items-center justify-between">
              {editingGroupName === groupName ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); commitGroupRename() }}
                  className="flex items-center gap-1.5 flex-1"
                >
                  <input
                    type="text"
                    value={editingGroupValue}
                    onChange={(e) => setEditingGroupValue(e.target.value)}
                    onBlur={commitGroupRename}
                    onKeyDown={(e) => { if (e.key === 'Escape') { setEditingGroupName(null); setEditingGroupValue('') } }}
                    className={cn(
                      'flex-1 px-2 py-0.5 rounded-md text-sm font-medium',
                      'bg-white/5 border border-white/20',
                      'text-white',
                      'focus:outline-none focus:ring-1 focus:ring-purple-500/40'
                    )}
                    autoFocus
                    autoComplete="off"
                  />
                </form>
              ) : (
                <button
                  onClick={() => toggleGroup(groupName)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingGroupName(groupName)
                    setEditingGroupValue(groupName)
                  }}
                  className="flex items-center gap-1.5 text-sm font-medium text-white hover:text-slate-300 transition-colors"
                >
                  {isCollapsed
                    ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  }
                  {groupName}
                  <span className="text-xs text-slate-500 font-normal ml-1">
                    {checkedCount}/{total}
                    {crossedCount > 0 && <span className="text-red-400/60 ml-1">({crossedCount} blocked)</span>}
                  </span>
                </button>
              )}
            </div>

            {total > 0 && !isCollapsed && (
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, #10b981, #06d6a0)',
                    boxShadow: '0 0 8px rgba(16,185,129,0.5)',
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            <AnimatePresence mode="popLayout">
              {!isCollapsed && groupItems.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={cn(
                    'group p-2.5 rounded-lg border transition-all duration-200',
                    'bg-white/[0.03] border-white/[0.06]',
                    item.state === 'checked' && 'border-emerald-500/10',
                    item.state === 'crossed' && 'border-red-500/10'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <TriStateCheckbox
                      state={item.state}
                      onClick={() => onItemToggle?.(item.id, nextState(item.state))}
                    />

                    {editingItemId === item.id ? (
                      <form
                        onSubmit={(e) => { e.preventDefault(); commitItemEdit() }}
                        className="flex-1 min-w-0"
                      >
                        <input
                          type="text"
                          value={editingItemTitle}
                          onChange={(e) => setEditingItemTitle(e.target.value)}
                          onBlur={commitItemEdit}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setEditingItemId(null); setEditingItemTitle('') } }}
                          className={cn(
                            'w-full px-2 py-0.5 rounded-md text-sm',
                            'bg-white/5 border border-white/20',
                            'text-white',
                            'focus:outline-none focus:ring-1 focus:ring-emerald-500/40'
                          )}
                          autoFocus
                          autoComplete="off"
                        />
                      </form>
                    ) : (
                      <p
                        onDoubleClick={() => {
                          setEditingItemId(item.id)
                          setEditingItemTitle(item.title)
                        }}
                        className={cn(
                          'flex-1 text-sm transition-all duration-200 min-w-0 cursor-text',
                          item.state === 'checked' && 'line-through text-slate-500',
                          item.state === 'crossed' && 'line-through text-red-400/50',
                          item.state === 'unchecked' && 'text-slate-300'
                        )}
                      >
                        {item.title}
                      </p>
                    )}

                    <StatusBadge
                      status={item.status}
                      onStatusChange={(s) => onItemStatusChange?.(item.id, s)}
                    />

                    <button
                      onClick={() => onItemRemove?.(item.id)}
                      className={cn(
                        'flex-shrink-0 p-1 rounded text-slate-600 hover:text-red-400',
                        'hover:bg-red-500/10 transition-all duration-200',
                        'opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  {(item.startDate || item.endDate) && (
                    <div className="flex items-center gap-1 mt-1.5 ml-7 text-xs text-slate-500">
                      <Calendar className="w-3 h-3" />
                      {item.startDate && format(new Date(item.startDate), 'MMM d')}
                      {item.startDate && item.endDate && ' - '}
                      {item.endDate && format(new Date(item.endDate), 'MMM d')}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {!isCollapsed && addingInGroup === groupName && (
              <motion.form
                onSubmit={(e) => handleAddItem(e, groupName)}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-2.5 py-1.5"
              >
                <div className="flex-shrink-0 w-5 h-5 rounded border-2 border-white/10" />
                <input
                  type="text"
                  value={newItemTitle}
                  onChange={(e) => setNewItemTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setAddingInGroup(null); setNewItemTitle('') }
                  }}
                  onBlur={() => {
                    if (!newItemTitle.trim()) { setAddingInGroup(null); setNewItemTitle('') }
                  }}
                  placeholder="Add an item..."
                  className={cn(
                    'flex-1 px-0 py-0 text-sm bg-transparent border-none',
                    'text-white placeholder-slate-500',
                    'focus:outline-none'
                  )}
                  autoFocus
                  autoComplete="off"
                />
              </motion.form>
            )}

            {!isCollapsed && addingInGroup !== groupName && (
              <button
                onClick={() => { setAddingInGroup(groupName); setNewItemTitle('') }}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors mt-1"
              >
                <Plus className="w-3 h-3" />
                Add item
              </button>
            )}
          </div>
        )
      })}

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
              'focus:outline-none focus:ring-1 focus:ring-purple-500/40'
            )}
            autoFocus
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!newGroupName.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-purple-500/15 border border-purple-500/25 text-purple-400 disabled:opacity-50"
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
