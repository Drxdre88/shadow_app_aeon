'use client'

import { useState, useEffect } from 'react'
import { useThemeStore, DEFAULT_SHORTCUTS } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

const SHORTCUT_LABELS: Record<string, string> = {
  selectCard: 'Select Card (hover)',
  addCard: 'New Card',
  editCard: 'Edit Card',
  openLabel: 'Open Label Picker',
  changePriority: 'Change Priority',
  changeGlow: 'Change Color/Glow',
  toggleDone: 'Complete Card (done / not-doing / none)',
  toggleDates: 'Toggle Dates Display',
  toggleChecklist: 'Checklist Overview (off/preview/full)',
  assignMember: 'Assign Member (hover)',
  setProgress: 'Set Progress % (hover)',
}

const DASHBOARD_SHORTCUTS = [
  { keys: 'N', label: 'New project' },
  { keys: '1-9', label: 'Switch realm (1 = All)' },
]

const BOARD_FIXED_SHORTCUTS = [
  { keys: 'Ctrl+C / V', label: 'Copy / Paste card' },
  { keys: 'Arrows', label: 'Move selected card (L/R columns, U/D reorder)' },
  { keys: 'Double-click', label: 'Inline edit card title' },
]

const GLOBAL_SHORTCUTS = [
  { keys: '?', label: 'Open help' },
  { keys: 'Ctrl+K / /', label: 'Command palette' },
  { keys: 'Ctrl+Z', label: 'Undo last delete' },
  { keys: 'Escape', label: 'Deselect card / close modal' },
]

function ShortcutSection({ title, items }: { title: string; items: { keys: string; label: string }[] }) {
  return (
    <>
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider pt-4">{title}</h4>
      <div className="space-y-2">
        {items.map(({ keys, label }) => (
          <div
            key={keys}
            className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10"
          >
            <span className="text-sm text-slate-300">{label}</span>
            <span className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border border-white/10 bg-white/5 text-slate-400 min-w-[60px] text-center">
              {keys}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

export function ShortcutsTab() {
  const { shortcuts, setShortcut, colors } = useThemeStore()
  const [remapping, setRemapping] = useState<string | null>(null)

  useEffect(() => {
    if (!remapping) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRemapping(null)
        return
      }
      const key = e.key.toLowerCase()
      setShortcut(remapping, key)
      setRemapping(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [remapping, setShortcut])

  return (
    <div className="space-y-4 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Board Shortcuts (customizable)</h4>
      <div className="space-y-2">
        {Object.entries(SHORTCUT_LABELS).map(([action, label]) => (
          <div
            key={action}
            className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10"
          >
            <span className="text-sm text-slate-300">{label}</span>
            <button
              onClick={() => setRemapping(action)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-mono font-bold border transition-all min-w-[60px] text-center',
                remapping === action
                  ? 'border-purple-500 bg-purple-500/20 text-purple-300 animate-pulse'
                  : 'border-white/20 bg-white/5 text-white hover:border-white/40 hover:bg-white/10'
              )}
              style={remapping !== action ? { boxShadow: `0 0 8px ${colors.glowColor}40` } : {}}
            >
              {remapping === action ? '...' : (shortcuts[action] ?? DEFAULT_SHORTCUTS[action]).toUpperCase()}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">Click a key binding, then press any key to remap. Escape to cancel.</p>

      <ShortcutSection title="Dashboard Shortcuts" items={DASHBOARD_SHORTCUTS} />
      <ShortcutSection title="Board Shortcuts (fixed)" items={BOARD_FIXED_SHORTCUTS} />
      <ShortcutSection title="Global Shortcuts" items={GLOBAL_SHORTCUTS} />
    </div>
  )
}
