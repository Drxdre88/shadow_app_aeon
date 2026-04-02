'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Palette } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig } from '@/lib/utils/colors'

interface TaskColorPickerProps {
  taskId: string
  isOpen: boolean
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
}

export function TaskColorPicker({ taskId, isOpen, onClose, onTaskUpdate }: TaskColorPickerProps) {
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { tasks, updateTask } = useBoardStore()
  const task = tasks.find((t) => t.id === taskId)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose])

  if (!mounted || !isOpen || !task) return null

  const handleColorSelect = (color: string) => {
    updateTask(taskId, { color })
    onTaskUpdate?.(taskId, { color })
    onClose()
  }

  const currentColor = task.color
  const currentHex = currentColor.startsWith('#')
    ? currentColor
    : colorConfig[currentColor as AccentColor]?.hex ?? '#a855f7'

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
            'w-[340px] overflow-hidden rounded-xl',
            'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
            'shadow-[0_0_40px_rgba(0,0,0,0.6),0_0_15px_rgba(139,92,246,0.15)]',
            'flex flex-col'
          )}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4" style={{ color: 'var(--primary)' }} />
              <span className="text-sm font-medium text-white">Card Glow</span>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => handleColorSelect(color)}
                  className={cn(
                    'w-8 h-8 rounded-lg transition-all duration-200',
                    colorConfig[color].bgSolid,
                    currentColor === color && 'ring-2 ring-offset-1 ring-offset-black ring-white scale-110'
                  )}
                  style={{
                    boxShadow: currentColor === color ? `0 0 12px ${colorConfig[color].glow}` : undefined,
                  }}
                />
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {PALETTE_COLORS.map((hex) => (
                <button
                  key={hex}
                  onClick={() => handleColorSelect(hex)}
                  className={cn(
                    'w-8 h-8 rounded-lg border-2 transition-all',
                    currentColor === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>

            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input
                  type="color"
                  value={currentHex}
                  onChange={(e) => handleColorSelect(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="w-8 h-8 rounded-lg border-2 border-dashed border-white/30 group-hover:border-white/60 transition-all flex items-center justify-center"
                  style={{ backgroundColor: currentColor.startsWith('#') ? currentColor : 'transparent' }}
                >
                  {!currentColor.startsWith('#') && <span className="text-[10px] text-slate-500">+</span>}
                </div>
              </div>
              <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors">Custom</span>
            </label>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
