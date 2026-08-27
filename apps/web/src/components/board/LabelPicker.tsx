'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Tag, Check, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore, useLabels, useTasks } from '@/lib/store/boardStore'
import { AccentColor, colorConfig, generateId, hexToRgba } from '@/lib/utils/colors'
import { sortLabelsByName } from '@/lib/utils/labels'
import { ColorSwatchPicker } from './ColorSwatchPicker'

function resolveLabelColor(color: string) {
  const cfg = colorConfig[color as AccentColor]
  if (cfg) return { bgSolid: cfg.bgSolid, hex: cfg.hex, isCustom: false }
  const hex = color.startsWith('#') ? color : `#${color}`
  return { bgSolid: '', hex, isCustom: true }
}

interface LabelPickerProps {
  taskId: string
  projectId: string
  isOpen: boolean
  onClose: () => void
  /** May return a promise resolving `false` when server persistence failed (assignment is then rolled back). */
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
}

export function LabelPicker({
  taskId,
  projectId,
  isOpen,
  onClose,
  onLabelCreate,
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
}: LabelPickerProps) {
  const [mounted, setMounted] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string>('purple')
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState<string>('purple')
  const menuRef = useRef<HTMLDivElement>(null)
  const labels = useLabels()
  const tasks = useTasks()
  const addLabel = useBoardStore((s) => s.addLabel)
  const updateLabel = useBoardStore((s) => s.updateLabel)
  const removeLabel = useBoardStore((s) => s.removeLabel)
  const updateTask = useBoardStore((s) => s.updateTask)

  const task = tasks.find((t) => t.id === taskId)
  const projectLabels = sortLabelsByName(labels.filter((l) => l.projectId === projectId))

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) { setEditingId(null); return }
        if (isCreating) { setIsCreating(false); return }
        onClose()
      }
    }
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose, editingId, isCreating])

  if (!mounted || !isOpen || !task) return null

  const handleToggleLabel = (labelId: string) => {
    if (editingId) return
    const hasLabel = task.labels.includes(labelId)
    const newLabels = hasLabel
      ? task.labels.filter((id) => id !== labelId)
      : [...task.labels, labelId]
    updateTask(taskId, { labels: newLabels })
    onLabelToggle?.(taskId, labelId, hasLabel ? 'remove' : 'add')
  }

  const handleCreateLabel = () => {
    if (!newLabelName.trim()) return
    const newLabel = {
      id: generateId(),
      projectId,
      name: newLabelName.trim(),
      color: newLabelColor,
    }
    // Optimistic: the label appears in the picker and on the card instantly.
    addLabel(newLabel)
    updateTask(taskId, { labels: [...task.labels, newLabel.id] })
    const created = onLabelCreate?.(newLabel)
    // Persist the assignment only after the label exists server-side —
    // firing both in parallel loses the race (the FK insert fails and the
    // label silently drops off the card, forcing the user to retry).
    Promise.resolve(created).then((ok) => {
      if (ok === false) {
        const current = useBoardStore.getState().tasks.find((t) => t.id === taskId)
        if (current) {
          useBoardStore.getState().updateTask(taskId, {
            labels: current.labels.filter((id) => id !== newLabel.id),
          })
        }
        return
      }
      onLabelToggle?.(taskId, newLabel.id, 'add')
    })
    setNewLabelName('')
    setIsCreating(false)
  }

  const startEditing = (label: { id: string; name: string; color: string }) => {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
    setIsCreating(false)
  }

  const handleSaveEdit = () => {
    if (!editingId || !editName.trim()) return
    const updates: { name?: string; color?: string } = {}
    const label = projectLabels.find((l) => l.id === editingId)
    if (label) {
      if (editName.trim() !== label.name) updates.name = editName.trim()
      if (editColor !== label.color) updates.color = editColor
      if (Object.keys(updates).length > 0) {
        updateLabel(editingId, updates)
        onLabelUpdate?.(editingId, updates)
      }
    }
    setEditingId(null)
  }

  const handleDeleteLabel = (labelId: string) => {
    removeLabel(labelId)
    onLabelDelete?.(labelId)
    if (editingId === labelId) setEditingId(null)
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-[520px] max-h-[600px] overflow-hidden',
            'rounded-xl',
            'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
            'shadow-[0_0_40px_rgba(0,0,0,0.6),0_0_15px_rgba(139,92,246,0.15)]',
            'flex flex-col'
          )}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-medium text-white">Labels</span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {projectLabels.length === 0 && !isCreating && (
              <p className="text-xs text-slate-500 text-center py-4">No labels yet</p>
            )}

            {projectLabels.map((label) => {
              const isActive = task.labels.includes(label.id)
              const resolved = resolveLabelColor(label.color)
              const isEditing = editingId === label.id

              if (isEditing) {
                return (
                  <div key={label.id} className="p-2.5 rounded-lg bg-white/5 border border-white/10 space-y-2 mb-1">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="w-full px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                      autoFocus
                    />
                    <ColorSwatchPicker
                      value={editColor}
                      onChange={setEditColor}
                      swatchSize="sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDeleteLabel(label.id)}
                        className="px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1" />
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-slate-400 text-sm hover:bg-white/10"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editName.trim()}
                        className="px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                          borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
                          border: '1px solid',
                          color: 'var(--primary)',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={label.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all',
                    isActive ? 'bg-white/10' : 'hover:bg-white/5'
                  )}
                >
                  <button
                    onClick={() => handleToggleLabel(label.id)}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <div
                      className={cn('w-4 h-4 rounded flex-shrink-0 flex items-center justify-center', !resolved.isCustom && resolved.bgSolid)}
                      style={resolved.isCustom ? { backgroundColor: resolved.hex } : undefined}
                    >
                      {isActive && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <span className={cn('flex-1 text-left truncate', isActive ? 'text-white font-medium' : 'text-slate-300')}>
                      {label.name}
                    </span>
                  </button>
                  <div
                    className={cn('w-3 h-3 rounded-full flex-shrink-0', !resolved.isCustom && resolved.bgSolid)}
                    style={resolved.isCustom ? { backgroundColor: resolved.hex } : undefined}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditing(label) }}
                    className="p-1 rounded hover:bg-white/10 text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )
            })}

            {isCreating && (
              <div className="p-2 space-y-2 border-t border-white/10 mt-1">
                <input
                  type="text"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateLabel()
                    if (e.key === 'Escape') setIsCreating(false)
                  }}
                  placeholder="Label name..."
                  className="w-full px-3 py-1.5 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                  autoFocus
                />
                <ColorSwatchPicker
                  value={newLabelColor}
                  onChange={setNewLabelColor}
                  swatchSize="sm"
                />
                <div className="flex gap-2">
                  <div className="flex-1" />
                  <button
                    onClick={() => setIsCreating(false)}
                    className="px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-slate-400 text-sm hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateLabel}
                    disabled={!newLabelName.trim()}
                    className="px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
                      border: '1px solid',
                      color: 'var(--primary)',
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </div>

          {!isCreating && !editingId && (
            <div className="border-t border-white/10 p-4">
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create new label
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
