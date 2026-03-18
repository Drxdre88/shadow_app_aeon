'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Palette, Trash2, Copy, Pencil, Sparkles, X, Archive, Package } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { COLUMN_ICONS } from '@/lib/utils/columnIcons'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { ContextMenuButton } from './ContextMenuButton'

interface ColumnContextMenuProps {
  columnId: string
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
  onColumnDelete?: (columnId: string) => void
  onVaultCompleted?: (columnId: string) => void
  onArchiveAll?: (columnId: string) => void
}

export function ColumnContextMenu({ columnId, position, onClose, onRename, onColumnDelete, onVaultCompleted, onArchiveAll }: ColumnContextMenuProps) {
  const [submenu, setSubmenu] = useState<'color' | 'icon' | null>(null)
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { columns, updateColumn, removeColumn } = useBoardStore()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const column = columns.find((c) => c.id === columnId)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  if (!mounted || !column) return null

  const menuStyle = {
    left: Math.min(position.x, window.innerWidth - 260),
    top: Math.min(position.y, window.innerHeight - 400),
  }

  const handleColor = (color: string) => {
    updateColumn(columnId, { color })
    onClose()
  }

  const handleColorNative = (color: string) => {
    updateColumn(columnId, { color })
  }

  const handleCopyId = () => {
    navigator.clipboard.writeText(columnId)
    onClose()
  }

  const handleDelete = () => {
    removeColumn(columnId)
    onColumnDelete?.(columnId)
    onClose()
  }

  const handleIcon = (icon: string | null) => {
    updateColumn(columnId, { icon })
    onClose()
  }

  const handleRename = () => {
    onRename()
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.92, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={cn(
          'fixed z-[200] min-w-[220px] max-h-[80vh] overflow-y-auto',
          'rounded-xl overflow-hidden',
          'backdrop-blur-2xl border',
          'py-1'
        )}
        style={{
          ...menuStyle,
          background: `linear-gradient(to bottom, rgba(20, 20, 32, 0.97), rgba(12, 12, 20, 0.98))`,
          borderColor: `${colors.glowColor.replace(/[\d.]+\)$/, '0.2)')}`,
          boxShadow: [
            `0 0 ${40 * mult}px ${10 * mult}px ${colors.glowColor.replace(/[\d.]+\)$/, '0.25)')}`,
            `0 0 ${80 * mult}px ${20 * mult}px ${colors.glowColor.replace(/[\d.]+\)$/, '0.08)')}`,
            `0 25px 50px -12px rgba(0, 0, 0, 0.7)`,
            `inset 0 1px 0 0 rgba(255, 255, 255, 0.08)`,
          ].join(', '),
        }}
      >
        <div
          className="absolute top-0 left-3 right-3 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${colors.primary}, transparent)`,
            boxShadow: `0 0 ${8 * mult}px ${colors.glowColor}`,
          }}
        />
        <ContextMenuButton
          icon={Pencil}
          label="Rename"
          onClick={handleRename}
          glowColor={colors.glowColor}
        />

        <ContextMenuButton
          icon={Palette}
          label="Color"
          hasSubmenu
          isActive={submenu === 'color'}
          onClick={() => setSubmenu(submenu === 'color' ? null : 'color')}
          glowColor={colors.glowColor}
        />
        {submenu === 'color' && (
          <div className="px-3 py-2">
            <ColorSwatchPicker
              value={column.color}
              onChange={handleColor}
              onChangeNative={handleColorNative}
            />
          </div>
        )}

        <ContextMenuButton
          icon={Sparkles}
          label="Icon"
          hasSubmenu
          isActive={submenu === 'icon'}
          onClick={() => setSubmenu(submenu === 'icon' ? null : 'icon')}
          glowColor={colors.glowColor}
        />
        {submenu === 'icon' && (
          <div className="px-3 py-2">
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => handleIcon(null)}
                className={cn(
                  'w-7 h-7 rounded-lg border transition-all flex items-center justify-center',
                  !column.icon ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-slate-500 hover:border-white/30 hover:text-slate-300'
                )}
                title="No icon"
              >
                <X className="w-3 h-3" />
              </button>
              {COLUMN_ICONS.map((ci) => {
                const CIcon = ci.icon
                const isActive = column.icon === ci.id
                return (
                  <button
                    key={ci.id}
                    onClick={() => handleIcon(ci.id)}
                    className={cn(
                      'w-7 h-7 rounded-lg border transition-all flex items-center justify-center',
                      isActive ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-slate-500 hover:border-white/30 hover:text-slate-300'
                    )}
                    title={ci.label}
                  >
                    <CIcon className="w-3.5 h-3.5" />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <button
          onClick={handleCopyId}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Copy className="w-4 h-4" />
          Copy ID
        </button>

        {onArchiveAll && (
          <button
            onClick={() => { onArchiveAll(columnId); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors"
            style={{
              textShadow: `0 0 ${8 * mult}px rgba(245,158,11,${0.4 * mult})`,
            }}
          >
            <Package className="w-4 h-4" />
            Archive all tasks
          </button>
        )}

        {onVaultCompleted && (
          <button
            onClick={() => { onVaultCompleted(columnId); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            style={{
              textShadow: `0 0 ${8 * mult}px rgba(16,185,129,${0.4 * mult})`,
            }}
          >
            <Archive className="w-4 h-4" />
            Send completed to Vault
          </button>
        )}

        <div className="border-t border-white/10 mt-1 pt-1">
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

