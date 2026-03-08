'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, Palette, Flag, Trash2, MoveRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore, type BoardColumn } from '@/lib/store/boardStore'
import { AccentColor, colorConfig } from '@/lib/utils/colors'

interface TaskContextMenuProps {
  taskId: string
  position: { x: number; y: number }
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
}

const ACCENT_COLORS: AccentColor[] = ['purple', 'blue', 'cyan', 'green', 'pink', 'orange', 'red']
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const priorityColors = {
  low: 'text-slate-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

export function TaskContextMenu({ taskId, position, onClose, onTaskUpdate, onTaskDelete }: TaskContextMenuProps) {
  const [submenu, setSubmenu] = useState<'move' | 'priority' | 'color' | null>(null)
  const [mounted, setMounted] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { tasks, columns, updateTask, removeTask } = useBoardStore()

  const task = tasks.find((t) => t.id === taskId)
  const projectColumns = columns.filter((c) => c.projectId === task?.projectId)

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

  if (!mounted || !task) return null

  const menuStyle = {
    left: Math.min(position.x, window.innerWidth - 220),
    top: Math.min(position.y, window.innerHeight - 300),
  }

  const handleMoveTo = (columnId: string) => {
    updateTask(taskId, { columnId })
    onTaskUpdate?.(taskId, { columnId })
    onClose()
  }

  const handlePriority = (priority: string) => {
    updateTask(taskId, { priority: priority as any })
    onTaskUpdate?.(taskId, { priority })
    onClose()
  }

  const handleColor = (color: string) => {
    updateTask(taskId, { color })
    onTaskUpdate?.(taskId, { color })
    onClose()
  }

  const handleDelete = () => {
    removeTask(taskId)
    onTaskDelete?.(taskId)
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.12 }}
        className={cn(
          'fixed z-[200] min-w-[200px]',
          'rounded-xl overflow-hidden',
          'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
          'shadow-[0_0_40px_rgba(0,0,0,0.6),0_0_15px_rgba(139,92,246,0.15)]',
          'py-1'
        )}
        style={menuStyle}
      >
        <MenuButton
          icon={MoveRight}
          label="Move to..."
          hasSubmenu
          isActive={submenu === 'move'}
          onMouseEnter={() => setSubmenu('move')}
        />
        {submenu === 'move' && (
          <div className="pl-2 border-l border-white/10 ml-3 space-y-0.5 py-1">
            {projectColumns
              .filter((c) => c.id !== task.columnId)
              .map((col) => (
                <button
                  key={col.id}
                  onClick={() => handleMoveTo(col.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10 hover:text-white rounded-md transition-colors"
                >
                  <ArrowRight className="w-3 h-3 text-slate-500" />
                  {col.name}
                </button>
              ))}
          </div>
        )}

        <MenuButton
          icon={Flag}
          label="Priority"
          hasSubmenu
          isActive={submenu === 'priority'}
          onMouseEnter={() => setSubmenu('priority')}
        />
        {submenu === 'priority' && (
          <div className="pl-2 border-l border-white/10 ml-3 space-y-0.5 py-1">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => handlePriority(p)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-white/10',
                  task.priority === p ? 'bg-white/10 font-medium' : '',
                  priorityColors[p]
                )}
              >
                <Flag className="w-3 h-3" />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        )}

        <MenuButton
          icon={Palette}
          label="Color"
          hasSubmenu
          isActive={submenu === 'color'}
          onMouseEnter={() => setSubmenu('color')}
        />
        {submenu === 'color' && (
          <div className="flex gap-1.5 px-4 py-2">
            {ACCENT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => handleColor(c)}
                className={cn(
                  'w-6 h-6 rounded-full border-2 transition-all',
                  task.color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                )}
                style={{ backgroundColor: colorConfig[c].hex }}
              />
            ))}
          </div>
        )}

        <div className="border-t border-white/10 mt-1 pt-1">
          <button
            onClick={handleDelete}
            onMouseEnter={() => setSubmenu(null)}
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
  onMouseEnter,
}: {
  icon: typeof MoveRight
  label: string
  hasSubmenu?: boolean
  isActive?: boolean
  onMouseEnter?: () => void
}) {
  return (
    <button
      onMouseEnter={onMouseEnter}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors',
        isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        {label}
      </span>
      {hasSubmenu && <ArrowRight className="w-3 h-3 text-slate-500" />}
    </button>
  )
}
