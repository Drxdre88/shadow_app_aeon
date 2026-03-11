'use client'

import { useState, useEffect } from 'react'
import { useThemeStore, DEFAULT_SHORTCUTS } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

const SHORTCUT_LABELS: Record<string, string> = {
  openLabel: 'Open Label Picker',
  addTask: 'New Task',
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
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Keyboard Shortcuts</h4>
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
    </div>
  )
}
