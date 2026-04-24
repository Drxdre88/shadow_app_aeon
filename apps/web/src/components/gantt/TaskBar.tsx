'use client'

import { useMemo, useCallback, useRef, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils/cn'
import { colorConfig, resolveColor, AccentColor } from '@/lib/utils/colors'
import { useGanttStore } from '@/lib/store/ganttStore'

interface TaskBarProps {
  task: {
    id: string
    name: string
    color: AccentColor
    progress: number
    boardTaskId?: string | null
  }
  style: {
    left: number
    width: number
    top: number
  }
  cellWidth: number
  timeScale: 'day' | 'week' | 'month'
  onTaskClick?: (boardTaskId: string) => void
  onResize?: (taskId: string, edge: 'left' | 'right', daysDelta: number) => void
  onRename?: (taskId: string, name: string) => void
}

export function TaskBar({ task, style, cellWidth, timeScale, onTaskClick, onResize, onRename }: TaskBarProps) {
  const { selectedTaskId, selectTask } = useGanttStore()
  const isSelected = selectedTaskId === task.id
  const preset = colorConfig[task.color]
  const resolved = resolveColor(task.color)
  const isPreset = !!preset

  const resizingRef = useRef<{ edge: 'left' | 'right'; startX: number } | null>(null)
  const [resizeDelta, setResizeDelta] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)


  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: 'task', task },
    disabled: !!resizingRef.current || isEditing,
  })

  const pxPerDay = useMemo(() => {
    switch (timeScale) {
      case 'day': return cellWidth
      case 'week': return cellWidth / 7
      case 'month': return cellWidth / 30
    }
  }, [cellWidth, timeScale])

  const handleResizeStart = useCallback((edge: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    resizingRef.current = { edge, startX: e.clientX }
    setResizeDelta(0)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const dx = e.clientX - resizingRef.current.startX
      setResizeDelta(dx)
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const dx = e.clientX - resizingRef.current.startX
      const daysDelta = Math.round(dx / pxPerDay)
      if (daysDelta !== 0 && onResize) {
        onResize(task.id, resizingRef.current.edge, daysDelta)
      }
      resizingRef.current = null
      setResizeDelta(0)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [pxPerDay, onResize, task.id])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(task.name)
    setIsEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [task.name])

  const commitRename = useCallback(() => {
    const trimmed = editName.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== task.name && onRename) {
      onRename(task.id, trimmed)
    }
  }, [editName, task.id, task.name, onRename])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') setIsEditing(false)
  }, [commitRename])

  const dragStyle = transform ? {
    transform: CSS.Translate.toString(transform),
  } : undefined


  const resizeStyle = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    if (!resizingRef.current || resizeDelta === 0) return { left: style.left, width: style.width }
    // eslint-disable-next-line react-hooks/refs
    if (resizingRef.current.edge === 'left') {
      return {
        left: style.left + resizeDelta,
        width: Math.max(20, style.width - resizeDelta),
      }
    }
    return {
      left: style.left,
      width: Math.max(20, style.width + resizeDelta),
    }
  }, [style.left, style.width, resizeDelta])

  const glowStyle = useMemo(() => ({
    boxShadow: isSelected
      ? `0 0 30px 10px ${resolved.glow}`
      : `0 0 15px 3px ${resolved.glowDark}`,
  }), [isSelected, resolved])

  // eslint-disable-next-line react-hooks/refs
  const isResizing = !!resizingRef.current
  const whileHoverProp = isResizing ? undefined : { scale: 1.02, y: -1 }
  const whileTapProp = isResizing ? undefined : { scale: 0.98 }

  return (
    <motion.div
      ref={setNodeRef}
      {...attributes}
      {...(isEditing ? {} : listeners)}
      onClick={() => {
        if (resizingRef.current || isEditing) return
        selectTask(task.id)
        if (task.boardTaskId && onTaskClick) onTaskClick(task.boardTaskId)
      }}
      className={cn(
        'absolute h-10 rounded-lg cursor-grab active:cursor-grabbing group',
        'backdrop-blur-md border',
        isPreset && preset.border,
        isDragging && 'opacity-80 z-50',
        isSelected && 'ring-2 ring-offset-2 ring-offset-background'
      )}
      style={{
        left: `${resizeStyle.left}px`,
        width: `${resizeStyle.width}px`,
        top: `${style.top}px`,
        background: `linear-gradient(to right, ${resolved.hex}cc, ${resolved.hex}99)`,
        ...(!isPreset ? resolved.borderStyle : {}),
        ...glowStyle,
        ...dragStyle,
        transition: isDragging || isResizing ? 'none' : 'left 150ms ease, width 150ms ease',
      }}
      whileHover={whileHoverProp}
      whileTap={whileTapProp}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-center h-full px-3">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            className="text-sm font-medium text-white bg-transparent outline-none w-full"
            autoFocus
          />
        ) : (
          <span
            className="text-sm font-medium text-white truncate drop-shadow-md"
            onDoubleClick={handleDoubleClick}
          >
            {task.name}
          </span>
        )}
      </div>

      {task.progress > 0 && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-white/50 rounded-b-lg transition-all duration-300"
          style={{ width: `${task.progress}%` }}
        />
      )}

      <div
        onMouseDown={(e) => handleResizeStart('left', e)}
        className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-6 rounded-full bg-white/30
                   cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
      />
      <div
        onMouseDown={(e) => handleResizeStart('right', e)}
        className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-6 rounded-full bg-white/30
                   cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
      />
    </motion.div>
  )
}
