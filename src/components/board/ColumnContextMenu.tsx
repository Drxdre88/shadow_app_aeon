'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Palette, Trash2, Copy, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'

interface ColumnContextMenuProps {
  columnId: string
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
  onColumnDelete?: (columnId: string) => void
}

export function ColumnContextMenu({ columnId, position, onClose, onRename, onColumnDelete }: ColumnContextMenuProps) {
  const [submenu, setSubmenu] = useState<'color' | null>(null)
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
        <MenuButton
          icon={Pencil}
          label="Rename"
          onClick={handleRename}
          glowColor={colors.glowColor}
        />

        <MenuButton
          icon={Palette}
          label="Color"
          hasSubmenu
          isActive={submenu === 'color'}
          onClick={() => setSubmenu(submenu === 'color' ? null : 'color')}
          glowColor={colors.glowColor}
        />
        {submenu === 'color' && (
          <div className="px-3 py-2 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => handleColor(c)}
                  className={cn(
                    'w-7 h-7 rounded-full border-2 transition-all',
                    column.color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                  )}
                  style={{ backgroundColor: colorConfig[c].hex }}
                />
              ))}
            </div>
            <div className="border-t border-white/10 pt-2">
              <div className="grid grid-cols-7 gap-1">
                {PALETTE_COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => handleColor(hex)}
                    className={cn(
                      'w-7 h-7 rounded-full border-2 transition-all',
                      column.color === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                    )}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
            <div className="pt-1 border-t border-white/10">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative">
                  <input
                    type="color"
                    value={column.color?.startsWith('#') ? column.color : colorConfig[column.color as AccentColor]?.hex ?? '#a855f7'}
                    onChange={(e) => handleColorNative(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="w-7 h-7 rounded-full border-2 border-dashed border-white/30 group-hover:border-white/60 transition-all flex items-center justify-center"
                    style={{ backgroundColor: column.color?.startsWith('#') ? column.color : 'transparent' }}
                  >
                    {!column.color?.startsWith('#') && <Palette className="w-3 h-3 text-slate-400" />}
                  </div>
                </div>
                <span className="text-[11px] text-slate-500 group-hover:text-slate-300 transition-colors">Custom</span>
              </label>
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

function MenuButton({
  icon: Icon,
  label,
  hasSubmenu,
  isActive,
  onClick,
  glowColor,
}: {
  icon: typeof Pencil
  label: string
  hasSubmenu?: boolean
  isActive?: boolean
  onClick?: () => void
  glowColor?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm transition-all duration-150',
        isActive
          ? 'text-white'
          : 'text-slate-300 hover:text-white'
      )}
      style={isActive && glowColor ? {
        background: glowColor.replace(/[\d.]+\)$/, '0.1)'),
      } : {}}
    >
      <span className="flex items-center gap-2">
        <Icon
          className="w-4 h-4 transition-colors"
          style={isActive && glowColor ? { color: glowColor.replace(/[\d.]+\)$/, '0.8)') } : {}}
        />
        {label}
      </span>
      {hasSubmenu && (
        <ArrowRight
          className={cn('w-3 h-3 transition-transform duration-200', isActive ? 'rotate-90' : '')}
          style={isActive && glowColor ? { color: glowColor.replace(/[\d.]+\)$/, '0.7)') } : { color: 'rgb(100,116,139)' }}
        />
      )}
    </button>
  )
}
