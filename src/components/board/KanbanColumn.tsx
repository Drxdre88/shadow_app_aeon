'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence } from 'framer-motion'
import { ListTodo, Activity, Eye, CheckCircle2, Plus, Columns3, Pencil, Check, X, Palette } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SortableTaskCard } from './SortableTaskCard'
import { QuickAddTask } from './QuickAddTask'
import { ColumnContextMenu } from './ColumnContextMenu'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig, hexToRgba } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import type { BoardColumn } from '@/lib/store/boardStore'

interface KanbanColumnProps {
  column: BoardColumn
  projectId: string
  tasks: Array<{
    id: string
    name: string
    description?: string
    color: string
    priority: 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    startDate?: string
    endDate?: string
    onTimeline: boolean
  }>
  onTaskEdit?: (taskId: string) => void
  onAddTask?: () => void
  onTaskCreate?: (task: {
    id: string
    projectId: string
    name: string
    columnId: string
    status: string
    priority: string
    color: string
    labels: string[]
    onTimeline: boolean
    orderIndex: number
  }) => void
  onColumnRename?: (columnId: string, name: string) => void
  onColumnColorChange?: (columnId: string, color: string) => void
  onColumnDelete?: (columnId: string) => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
  overId?: string | null
  activeTaskId?: string | null
  onDependencyClick?: (taskId: string) => void
  dragHandleProps?: Record<string, unknown>
}

const ICON_MAP: Record<string, typeof ListTodo> = {
  'list-todo': ListTodo,
  'activity': Activity,
  'eye': Eye,
  'check-circle': CheckCircle2,
}

function getColumnColor(color: string) {
  const colorMap: Record<string, { bg: string; text: string; border: string; glow: string; glowColor: string; styles?: Record<string, React.CSSProperties> }> = {
    pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30', glow: 'shadow-[0_0_10px_rgba(236,72,153,0.3)]', glowColor: 'rgba(236,72,153,0.6)' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]', glowColor: 'rgba(59,130,246,0.6)' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', glow: 'shadow-[0_0_10px_rgba(168,85,247,0.3)]', glowColor: 'rgba(168,85,247,0.6)' },
    green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.3)]', glowColor: 'rgba(16,185,129,0.6)' },
    cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', glow: 'shadow-[0_0_10px_rgba(34,211,238,0.3)]', glowColor: 'rgba(34,211,238,0.6)' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-[0_0_10px_rgba(249,115,22,0.3)]', glowColor: 'rgba(249,115,22,0.6)' },
    red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-[0_0_10px_rgba(239,68,68,0.3)]', glowColor: 'rgba(239,68,68,0.6)' },
  }

  if (colorMap[color]) return { ...colorMap[color], isCustom: false }

  const hex = color.startsWith('#') ? color : `#${color}`
  return {
    bg: '',
    text: '',
    border: '',
    glow: '',
    glowColor: hexToRgba(hex, 0.6),
    isCustom: true,
    styles: {
      badge: {
        backgroundColor: hexToRgba(hex, 0.1),
        borderColor: hexToRgba(hex, 0.3),
        color: hex,
      } as React.CSSProperties,
      glow: {
        boxShadow: `0 0 10px ${hexToRgba(hex, 0.3)}`,
      } as React.CSSProperties,
    },
  }
}

export function KanbanColumn({
  column,
  projectId,
  tasks,
  onTaskEdit,
  onAddTask,
  onTaskCreate,
  onColumnRename,
  onColumnColorChange,
  onColumnDelete,
  onTaskUpdate,
  onTaskDelete,
  overId,
  activeTaskId,
  onDependencyClick,
  dragHandleProps,
}: KanbanColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(column.name)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const { glowIntensity: globalGlow, columnWidth: globalColumnWidth, columnHeight: globalColumnHeight, dynamicColumnWidth, dynamicColumnHeight } = useThemeStore()
  const dynamicW = dynamicColumnWidth
    ? Math.min(800, globalColumnWidth + Math.max(0, tasks.length - 3) * 20)
    : globalColumnWidth
  const dynamicH = dynamicColumnHeight
    ? Math.min(800, globalColumnHeight + Math.max(0, tasks.length - 3) * 40)
    : globalColumnHeight
  const [columnWidth, setColumnWidth] = useState(dynamicW)
  const [columnHeight, setColumnHeight] = useState(dynamicH)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const config = getColumnColor(column.color)
  const Icon = (column.icon && ICON_MAP[column.icon]) || Columns3
  const mult = globalGlow / 75

  useEffect(() => {
    setColumnWidth(dynamicW)
  }, [dynamicW])

  useEffect(() => {
    setColumnHeight(dynamicH)
  }, [dynamicH])

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  })

  const taskIds = tasks.map((t) => t.id)

  const dynamicGlow = globalGlow > 0 && !config.isCustom
    ? { boxShadow: config.glow.replace(/0_0_(\d+)px/g, (_, num: string) => `0_0_${Math.round(parseInt(num) * mult)}px`) }
    : globalGlow > 0 && config.isCustom && config.styles
      ? config.styles.glow
      : {}

  useEffect(() => {
    if (!showColorPicker) return
    const handleClick = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColorPicker])

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== column.name) {
      onColumnRename?.(column.id, trimmed)
    }
    setIsRenaming(false)
  }

  const handleColorChange = (color: string) => {
    onColumnColorChange?.(column.id, color)
    setShowColorPicker(false)
  }

  const handleColorNative = (color: string) => {
    onColumnColorChange?.(column.id, color)
  }

  const handleWidthResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      setColumnWidth(Math.max(250, Math.min(600, startWidth + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [columnWidth])

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startHeight = columnHeight

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      setColumnHeight(Math.max(200, Math.min(800, startHeight + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [columnHeight])

  const badgeClasses = config.isCustom
    ? 'border backdrop-blur-md'
    : cn('border backdrop-blur-md', config.bg, config.border, config.text, globalGlow > 0 && config.glow)
  const badgeStyle = config.isCustom && config.styles
    ? { ...config.styles.badge, ...(globalGlow > 0 ? config.styles.glow : {}) }
    : dynamicGlow

  return (
    <div className="relative flex-shrink-0" style={{ width: `${columnWidth}px` }}>
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl',
        'glass transition-all duration-200',
        isOver && 'ring-2 ring-white/20'
      )}
      style={{ height: `${columnHeight}px` }}
    >
      <div
        className={cn('p-4 border-b border-white/10', dragHandleProps && !isRenaming && 'cursor-grab active:cursor-grabbing')}
        {...(dragHandleProps && !isRenaming ? dragHandleProps : {})}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isRenaming ? (
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="flex-1 px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  autoFocus
                />
                <button onClick={handleRenameSubmit} className="p-1 rounded hover:bg-white/10 text-emerald-400">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsRenaming(false)} className="p-1 rounded hover:bg-white/10 text-slate-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer',
                  badgeClasses
                )}
                style={badgeStyle}
                onDoubleClick={() => {
                  setRenameValue(column.name)
                  setIsRenaming(true)
                }}
              >
                <Icon className="w-4 h-4" />
                <span>{column.name}</span>
                <span className="font-bold">{tasks.length}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 relative">
            {!isRenaming && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowColorPicker(!showColorPicker)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <Palette className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenameValue(column.name)
                    setIsRenaming(true)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onAddTask?.() }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              <Plus className="w-4 h-4 text-slate-400" />
            </button>

            {showColorPicker && (
              <div
                ref={colorPickerRef}
                className="absolute top-full right-0 mt-2 z-50 p-4 rounded-xl backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)] space-y-3 min-w-[320px]"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex gap-1.5 flex-wrap">
                  {ACCENT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleColorChange(c)}
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
                        onClick={() => handleColorChange(hex)}
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
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onEdit={() => onTaskEdit?.(task.id)}
                onDependencyClick={onDependencyClick}
                columnGlowColor={config.glowColor}
                showDropIndicator={overId === task.id && activeTaskId !== task.id}
                onTaskUpdate={onTaskUpdate}
                onTaskDelete={onTaskDelete}
              />
            ))}
          </AnimatePresence>
        </SortableContext>

        <div className="mt-2">
          <QuickAddTask
            projectId={projectId}
            columnId={column.id}
            onTaskCreate={onTaskCreate}
          />
        </div>
      </div>

      <div
        className="h-2 cursor-row-resize flex items-center justify-center hover:bg-white/10 transition-colors group"
        onMouseDown={handleResizeMouseDown}
      >
        <div className="w-12 h-0.5 rounded-full bg-white/10 group-hover:bg-white/30 transition-colors" />
      </div>
    </div>

    <div
      className="absolute top-0 right-0 w-2 h-full cursor-col-resize flex items-center justify-center hover:bg-white/10 transition-colors group z-10"
      onMouseDown={handleWidthResize}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-0.5 h-12 rounded-full bg-white/10 group-hover:bg-white/30 transition-colors" />
    </div>

    {contextMenu && (
      <ColumnContextMenu
        columnId={column.id}
        position={contextMenu}
        onClose={() => setContextMenu(null)}
        onRename={() => {
          setRenameValue(column.name)
          setIsRenaming(true)
        }}
        onColumnDelete={onColumnDelete}
      />
    )}
    </div>
  )
}
