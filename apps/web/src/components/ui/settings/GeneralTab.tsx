'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus, Briefcase } from 'lucide-react'
import { useThemeStore, INITIAL_PRIORITIES, type CompletionMode } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { ToggleRow, ThemeSlider } from './shared'

function CompletionModeSetting() {
  const { completionMode, setCompletionMode } = useThemeStore()

  const options: { id: CompletionMode; label: string; desc: string }[] = [
    { id: 'done', label: 'On Done', desc: 'Timestamp recorded when task moves to Done column' },
    { id: 'vault', label: 'On Vault', desc: 'Timestamp recorded when task is pushed to trophy vault' },
  ]

  return (
    <div className="space-y-2 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Completion Tracking</h4>
      <p className="text-[10px] text-slate-600">Controls when the completion timestamp is recorded for velocity metrics</p>
      <div className="flex gap-2">
        {options.map(({ id, label, desc }) => (
          <button
            key={id}
            onClick={() => setCompletionMode(id)}
            className={cn(
              'flex-1 p-2.5 rounded-xl border transition-all text-left',
              completionMode === id
                ? 'border-[var(--primary)]/50 bg-[var(--primary)]/10'
                : 'border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06]'
            )}
          >
            <span className={cn('text-xs font-medium block mb-0.5', completionMode === id ? 'text-white' : 'text-slate-300')}>{label}</span>
            <p className="text-[10px] text-slate-500 leading-tight">{desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function BoardLayoutSetting() {
  const { columnWidth, setColumnWidth, columnHeight, setColumnHeight, dynamicColumnWidth, setDynamicColumnWidth, dynamicColumnHeight, setDynamicColumnHeight, colors } = useThemeStore()

  return (
    <div className="space-y-4 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Column Size</h4>
      <div className="space-y-3 max-w-[300px]">
        <div className="space-y-1">
          <ThemeSlider label="Width" value={columnWidth} onChange={setColumnWidth} min={250} max={1200} color={colors.glowColor} unit="px" />
          <ToggleRow label="Expand width with content" value={dynamicColumnWidth} onChange={setDynamicColumnWidth} color={colors.glowColor} />
        </div>
        <div className="space-y-1">
          <ThemeSlider label="Height" value={columnHeight} onChange={setColumnHeight} min={200} max={1600} color={colors.glowColor} unit="px" />
          <ToggleRow label="Expand height with content" value={dynamicColumnHeight} onChange={setDynamicColumnHeight} color={colors.glowColor} />
        </div>
      </div>
      <p className="text-[10px] text-slate-600">Sliders set the base size. Expand toggles let columns grow past that when they have more tasks.</p>
    </div>
  )
}

function PriorityManager() {
  const { priorities, updatePriority, addPriority, removePriority, resetPriorities } = useThemeStore()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#e879f9')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const coreIds = INITIAL_PRIORITIES.map((p) => p.id)

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const id = trimmed.toLowerCase().replace(/\s+/g, '-')
    if (priorities.some((p) => p.id === id)) return
    addPriority({ id, name: trimmed, color: newColor })
    setNewName('')
  }

  const handleStartEdit = (p: { id: string; name: string }) => {
    setEditingId(p.id)
    setEditValue(p.name)
  }

  const handleFinishEdit = (id: string) => {
    const trimmed = editValue.trim()
    if (trimmed) updatePriority(id, { name: trimmed })
    setEditingId(null)
  }

  return (
    <div className="space-y-3 max-w-md">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Priorities</h4>
        <button
          onClick={resetPriorities}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
        >
          Reset defaults
        </button>
      </div>
      <div className="space-y-1.5">
        {priorities.map((p) => {
          const isCore = coreIds.includes(p.id)
          const isEditing = editingId === p.id
          return (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 group">
              <label className="relative flex-shrink-0 cursor-pointer">
                <input
                  type="color"
                  value={p.color}
                  onChange={(e) => updatePriority(p.id, { color: e.target.value })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="w-4 h-4 rounded-full border border-white/20 hover:border-white/50 transition-all"
                  style={{ backgroundColor: p.color }}
                />
              </label>
              {isEditing ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.3)'; handleFinishEdit(p.id) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishEdit(p.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 bg-transparent text-white text-sm focus:outline-none"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.3)' }}
                  onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--primary)')}
                  autoFocus
                />
              ) : (
                <span
                  className="flex-1 text-sm text-slate-300 cursor-pointer hover:text-white transition-colors"
                  onDoubleClick={() => handleStartEdit(p)}
                >
                  {p.name}
                </span>
              )}
              {!isCore && (
                <button
                  onClick={() => removePriority(p.id)}
                  className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <label className="relative flex-shrink-0">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div
            className="w-8 h-8 rounded-lg border border-white/20 hover:border-white/40 cursor-pointer transition-all"
            style={{ backgroundColor: newColor }}
          />
        </label>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          placeholder="New priority name..."
          className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-white/20"
        />
        <motion.button
          onClick={handleAdd}
          disabled={!newName.trim()}
          className={cn(
            'p-2 rounded-lg transition-all border',
            newName.trim()
              ? 'bg-purple-500/20 border-purple-500/30 text-purple-400 hover:bg-purple-500/30'
              : 'bg-white/[0.03] border-white/10 text-slate-600 cursor-not-allowed'
          )}
          whileTap={{ scale: 0.95 }}
        >
          <Plus className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  )
}

function BusinessModeSetting() {
  const { businessMode, setBusinessMode, colors } = useThemeStore()

  return (
    <div className="space-y-2 max-w-md">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: businessMode ? `${colors.primary}25` : 'rgba(255,255,255,0.05)',
            border: `1px solid ${businessMode ? colors.primary + '40' : 'rgba(255,255,255,0.1)'}`,
          }}
        >
          <Briefcase className="w-4 h-4" style={{ color: businessMode ? colors.primary : 'rgb(100,116,139)' }} />
        </div>
        <div className="flex-1">
          <ToggleRow
            label="Business Mode"
            value={businessMode}
            onChange={setBusinessMode}
            color={colors.primary}
          />
        </div>
      </div>
      <p className="text-[10px] text-slate-600 pl-11">
        Strips all glows, effects, ambient blobs, cursor trails, and surface tint for a clean professional look. Your settings are restored when you toggle off.
      </p>
    </div>
  )
}

function CardPreviewSetting() {
  const { cardPreviewOnHover, setCardPreviewOnHover, colors } = useThemeStore()

  return (
    <div className="space-y-1 max-w-md">
      <ToggleRow
        label="Card Preview on Hover"
        value={cardPreviewOnHover}
        onChange={setCardPreviewOnHover}
        color={colors.primary}
      />
      <p className="text-[10px] text-slate-600 pl-12">
        Hold hover over a card for 600ms to see a rich preview with description, checklist, labels, and dependencies.
      </p>
    </div>
  )
}

function BoardActionToastsSetting() {
  const { boardActionToasts, setBoardActionToasts, colors } = useThemeStore()

  return (
    <div className="space-y-1 max-w-md">
      <ToggleRow
        label="Board Action Notifications"
        value={boardActionToasts}
        onChange={setBoardActionToasts}
        color={colors.primary}
      />
      <p className="text-[10px] text-slate-600 pl-12">
        Show toast notifications for card moves, updates, and deletes. Undo toasts always appear regardless.
      </p>
    </div>
  )
}

export function GeneralTab() {
  return (
    <div className="space-y-6">
      <BusinessModeSetting />
      <CardPreviewSetting />
      <BoardActionToastsSetting />
      <CompletionModeSetting />
      <BoardLayoutSetting />
      <PriorityManager />
    </div>
  )
}
