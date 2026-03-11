'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import { useThemeStore, INITIAL_PRIORITIES } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import { ToggleRow, CompactSlider } from './shared'

function BoardLayoutSetting() {
  const { columnWidth, setColumnWidth, columnHeight, setColumnHeight, dynamicColumnWidth, setDynamicColumnWidth, dynamicColumnHeight, setDynamicColumnHeight, colors } = useThemeStore()

  return (
    <div className="space-y-3 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Board Layout</h4>
      <div className="space-y-0.5">
        <ToggleRow label="Auto-expand width" value={dynamicColumnWidth} onChange={setDynamicColumnWidth} color={colors.glowColor} />
        <ToggleRow label="Auto-expand height" value={dynamicColumnHeight} onChange={setDynamicColumnHeight} color={colors.glowColor} />
      </div>
      <div className="space-y-2">
        <CompactSlider label="Column Width" value={columnWidth} onChange={setColumnWidth} min={250} max={500} color={colors.glowColor} />
        <CompactSlider label="Column Height" value={columnHeight} onChange={setColumnHeight} min={200} max={800} color={colors.glowColor} />
      </div>
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
                  onBlur={() => handleFinishEdit(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishEdit(p.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 bg-transparent border-b border-white/30 text-white text-sm focus:outline-none focus:border-purple-400"
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
          className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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

export function GeneralTab() {
  return (
    <div className="space-y-6">
      <BoardLayoutSetting />
      <PriorityManager />
    </div>
  )
}
