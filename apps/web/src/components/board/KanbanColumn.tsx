'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Plus, Check, X, Palette, Trash2, Focus, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { VirtualizedTaskList } from './VirtualizedTaskList'
import { ColumnContextMenu } from './ColumnContextMenu'
import { hexToRgba } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import { useShallow } from 'zustand/shallow'
import type { BoardColumn } from '@/lib/store/boardStore'
import { COLUMN_ICONS, COLUMN_ICON_MAP } from '@/lib/utils/columnIcons'
import { ColorSwatchPicker } from './ColorSwatchPicker'
import { ColumnDeleteModal } from './ColumnDeleteModal'
import { openZenMode } from './zenFlight'
import { clampManualColumnHeight, columnHeightScale } from './columnSizing'
import { useMovingTaskId } from '@/lib/store/boardStore'
import { useHoldToMoveActions } from './useHoldToMove'
import { useCoarsePointer } from '@/hooks/useCoarsePointer'

interface KanbanColumnProps {
  column: BoardColumn
  projectId: string
  tasks: Array<{
    id: string
    name: string
    description?: string
    status: string
    color: string
    priority: 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    startDate?: string
    endDate?: string
    onTimeline: boolean
    size?: number | null
    progress?: number | null
    updatedAt?: string
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
    size?: number | null
    orderIndex: number
  }) => void
  onColumnRename?: (columnId: string, name: string) => void
  onColumnColorChange?: (columnId: string, color: string) => void
  onColumnIconChange?: (columnId: string, icon: string | null) => void
  onColumnDelete?: (columnId: string) => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
  onPushToGantt?: (taskId: string) => void
  onSendToVault?: (taskId: string) => void
  onVaultCompleted?: (columnId: string) => void
  onArchiveTask?: (taskId: string) => void
  onArchiveColumn?: (columnId: string) => void
  overId?: string | null
  activeTaskId?: string | null
  onDependencyClick?: (taskId: string) => void
  dragHandleProps?: Record<string, unknown>
}


const COLUMN_COLOR_MAP: Record<string, { bg: string; text: string; border: string; glow: string; glowColor: string }> = {
  pink: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/30', glow: 'shadow-[0_0_10px_rgba(236,72,153,0.3)]', glowColor: 'rgba(236,72,153,0.6)' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', glow: 'shadow-[0_0_10px_rgba(59,130,246,0.3)]', glowColor: 'rgba(59,130,246,0.6)' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', glow: 'shadow-[0_0_10px_rgba(168,85,247,0.3)]', glowColor: 'rgba(168,85,247,0.6)' },
  green: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-[0_0_10px_rgba(16,185,129,0.3)]', glowColor: 'rgba(16,185,129,0.6)' },
  cyan: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30', glow: 'shadow-[0_0_10px_rgba(34,211,238,0.3)]', glowColor: 'rgba(34,211,238,0.6)' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', glow: 'shadow-[0_0_10px_rgba(249,115,22,0.3)]', glowColor: 'rgba(249,115,22,0.6)' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', glow: 'shadow-[0_0_10px_rgba(239,68,68,0.3)]', glowColor: 'rgba(239,68,68,0.6)' },
}

function getColumnColor(color: string) {

  if (COLUMN_COLOR_MAP[color]) return { ...COLUMN_COLOR_MAP[color], isCustom: false }

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

export const KanbanColumn = memo(function KanbanColumn({
  column,
  projectId,
  tasks,
  onTaskEdit,
  onAddTask,
  onTaskCreate,
  onColumnRename,
  onColumnColorChange,
  onColumnIconChange,
  onColumnDelete,
  onTaskUpdate,
  onTaskDelete,
  onPushToGantt,
  onSendToVault,
  onVaultCompleted,
  onArchiveTask,
  onArchiveColumn,
  overId,
  activeTaskId,
  onDependencyClick,
  dragHandleProps,
}: KanbanColumnProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(column.name)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const { glowIntensity: globalGlow, columnWidth: globalColumnWidth, columnHeight: globalColumnHeight, dynamicColumnWidth, dynamicColumnHeight } = useThemeStore(
    useShallow((s) => ({ glowIntensity: s.glowIntensity, columnWidth: s.columnWidth, columnHeight: s.columnHeight, dynamicColumnWidth: s.dynamicColumnWidth, dynamicColumnHeight: s.dynamicColumnHeight }))
  )
  const dynamicW = dynamicColumnWidth
    ? Math.min(900, globalColumnWidth + Math.max(0, tasks.length - 3) * 20)
    : globalColumnWidth
  const dynamicH = dynamicColumnHeight
    ? Math.min(1600, globalColumnHeight + Math.max(0, tasks.length - 3) * 40)
    : globalColumnHeight
  const [columnWidth, setColumnWidth] = useState(dynamicW)
  // Manual drag-resize pins an explicit pixel height on this column for the
  // session; null means content-fit under the viewport/preference cap.
  const [manualHeight, setManualHeight] = useState<number | null>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  // Hold-to-move: a tap on this column's empty space appends the lifted card.
  const movingTaskId = useMovingTaskId()
  const holdToMove = useHoldToMoveActions()
  // Touch never fires contextmenu on a column header (and where it does, the
  // long-press has already been claimed as a column drag), so the menu needs a
  // button that is simply always there.
  const coarsePointer = useCoarsePointer()
  const config = getColumnColor(column.color)
  const SelectedIcon = column.icon ? COLUMN_ICON_MAP[column.icon] : null
  const mult = globalGlow / 75

  useEffect(() => {
    setColumnWidth(dynamicW)
  }, [dynamicW])

  useEffect(() => {
    // Changing the global height preference releases per-column manual pins.
    // Keyed on the settings, not derived dynamicH — a card arriving in the
    // column must not silently undo a hand-sized pin.
    setManualHeight(null)
  }, [globalColumnHeight, dynamicColumnHeight])

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  })

  // Stable identity while the column's tasks are unchanged, so SortableContext
  // and the virtualized list don't see a fresh array on every unrelated render.
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks])

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

  const handleIconChange = (iconId: string | null) => {
    onColumnIconChange?.(column.id, iconId)
    setShowColorPicker(false)
  }

  const handleWidthResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      setColumnWidth(Math.max(280, Math.min(700, startWidth + delta)))
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
    // Drag works in real pixels of the rendered box (the handle's parent is
    // the column body), so the first pixel of drag responds — no dead band
    // against the stored preference scale. offsetHeight, not
    // getBoundingClientRect: the pinch transform must not skew the ratio
    // between mouse pixels and the pinned layout height.
    const colEl = (e.currentTarget as HTMLElement).parentElement
    const startHeight = colEl?.offsetHeight ?? 0

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY
      setManualHeight(clampManualColumnHeight(startHeight + delta))
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
  }, [])

  // Only the column's own surface counts: a tap on a card is handled by the
  // card (before/after), and controls keep their own meaning.
  const handleColumnClick = useCallback((e: React.MouseEvent) => {
    if (!movingTaskId || !holdToMove) return
    const target = e.target as Element | null
    if (target?.closest('[data-task-id], button, input, textarea, select, a, form')) return
    holdToMove.place({ columnId: column.id, kind: 'end' })
  }, [movingTaskId, holdToMove, column.id])

  const handleHeaderMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }))
  }, [])

  const badgeClasses = config.isCustom
    ? 'border backdrop-blur-md'
    : cn('border backdrop-blur-md', config.bg, config.border, config.text, globalGlow > 0 && config.glow)
  const badgeStyle = config.isCustom && config.styles
    ? { ...config.styles.badge, ...(globalGlow > 0 ? config.styles.glow : {}) }
    : dynamicGlow

  return (
    // The droppable is the OUTER lane, not the content-fit inner box: a card
    // released in the empty space below a short column must still land in
    // that column instead of falling through to closestCenter and a
    // neighbouring lane. flex-1 fills SortableColumn's stretched flex-col
    // wrapper (align-self on a block child would be inert).
    <div ref={setNodeRef} className="relative flex-1 min-h-0 kanban-col-outer" style={{ '--col-w': `${columnWidth}px` } as React.CSSProperties}>
    <div
      data-column-id={column.id}
      className={cn(
        'flex flex-col rounded-xl',
        'glass transition-all duration-200',
        'kanban-col-inner',
        isOver && 'ring-2 ring-white/20',
        movingTaskId && 'ring-1 ring-white/15 cursor-copy'
      )}
      onClick={handleColumnClick}
      style={{
        '--col-h-scale': String(columnHeightScale(dynamicH)),
        ...(manualHeight !== null ? { height: `${manualHeight}px` } : {}),
      } as React.CSSProperties}
    >
      <div
        className={cn('p-4 border-b border-white/10', dragHandleProps && !isRenaming && 'cursor-grab active:cursor-grabbing')}
        // manipulation, not none: horizontal board panning must still work
        // from a column header; the delayed TouchSensor long-press picks the
        // column up instead.
        style={dragHandleProps && !isRenaming ? { touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none' } : undefined}
        {...(dragHandleProps && !isRenaming ? dragHandleProps : {})}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0 flex justify-center">
            {isRenaming ? (
              <div className="flex items-center gap-1 w-full">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="flex-1 px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
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
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium cursor-pointer',
                  badgeClasses
                )}
                style={badgeStyle}
                onDoubleClick={() => {
                  setRenameValue(column.name)
                  setIsRenaming(true)
                }}
              >
                {SelectedIcon && <SelectedIcon className="w-3.5 h-3.5" />}
                <span>{column.name}</span>
                <span className="text-[11px] opacity-60 font-normal">{tasks.length}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 relative flex-shrink-0 group">
            {!isRenaming && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openZenMode(column.id)
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Zen mode"
              >
                <Focus className="w-3.5 h-3.5 text-slate-400" />
              </button>
            )}
            {!isRenaming && (
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
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(true)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg hover:bg-red-500/15 transition-colors opacity-0 group-hover:opacity-100"
              title="Delete column"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
            </button>
            <button
              data-column-menu
              onClick={handleHeaderMenu}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{ touchAction: 'manipulation' }}
              className={cn(
                'p-1.5 rounded-lg hover:bg-white/10 transition-colors',
                coarsePointer ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              title="Column menu"
              aria-label="Column menu"
            >
              <MoreVertical className="w-4 h-4 text-slate-400" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAddTask?.() }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title="Add card"
            >
              <Plus className="w-4 h-4 text-slate-400" />
            </button>

            {showColorPicker && (
              <div
                ref={colorPickerRef}
                className="absolute top-full right-0 mt-2 z-50 p-4 rounded-xl backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.6)] space-y-3 min-w-[320px] max-h-[70vh] overflow-y-auto"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ColorSwatchPicker
                  value={column.color}
                  onChange={handleColorChange}
                  onChangeNative={handleColorNative}
                  className="space-y-2"
                />
                <div className="pt-2 border-t border-white/10">
                  <span className="text-[11px] text-slate-500 mb-1.5 block">Icon</span>
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => handleIconChange(null)}
                      className={cn(
                        'w-7 h-7 rounded-lg border transition-all flex items-center justify-center text-[10px]',
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
                          onClick={() => handleIconChange(ci.id)}
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
              </div>
            )}
          </div>
        </div>
      </div>

      <VirtualizedTaskList
        tasks={tasks}
        taskIds={taskIds}
        columnId={column.id}
        projectId={projectId}
        glowColor={config.glowColor}
        overId={overId}
        activeTaskId={activeTaskId}
        onTaskEdit={onTaskEdit}
        onDependencyClick={onDependencyClick}
        onTaskUpdate={onTaskUpdate}
        onTaskDelete={onTaskDelete}
        onPushToGantt={onPushToGantt}
        onSendToVault={onSendToVault}
        onArchiveTask={onArchiveTask}
        onTaskCreate={onTaskCreate}
        zoomAware
      />

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
        onZenMode={() => openZenMode(column.id)}
        onColumnDelete={() => setShowDeleteConfirm(true)}
        onVaultCompleted={onVaultCompleted}
        onArchiveAll={onArchiveColumn}
      />
    )}

    <ColumnDeleteModal
      isOpen={showDeleteConfirm}
      columnName={column.name}
      taskCount={tasks.length}
      onConfirm={() => {
        setShowDeleteConfirm(false)
        onColumnDelete?.(column.id)
      }}
      onClose={() => setShowDeleteConfirm(false)}
    />
    </div>
  )
})
