'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Palette, Flag, Trash2, MoveRight, Copy, Calendar, Archive, Package, ArrowRight, FolderInput, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { AccentColor, ACCENT_COLORS, PALETTE_COLORS, colorConfig, getRecentColors, addRecentColor } from '@/lib/utils/colors'
import { useThemeStore } from '@/stores/themeStore'
import { ContextMenuButton } from './ContextMenuButton'
import { listProjectsForTransfer, copyTaskToProject, moveTaskToProject } from '@/lib/actions/transfer'

interface TaskContextMenuProps {
  taskId: string
  position: { x: number; y: number }
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>) => void
  onTaskDelete?: (taskId: string) => void
  onPushToGantt?: (taskId: string) => void
  onSendToVault?: (taskId: string) => void
  onArchiveTask?: (taskId: string) => void
}

export function TaskContextMenu({ taskId, position, onClose, onTaskUpdate, onTaskDelete, onPushToGantt, onSendToVault, onArchiveTask }: TaskContextMenuProps) {
  const [submenu, setSubmenu] = useState<'move' | 'priority' | 'color' | 'transfer' | null>(null)
  const [mounted, setMounted] = useState(false)
  const [transferProjects, setTransferProjects] = useState<{ id: string; name: string; columns: { id: string; name: string; color: string }[] }[]>([])
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferMode, setTransferMode] = useState<'copy' | 'move'>('copy')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { tasks, columns, updateTask, removeTask } = useBoardStore()
  const { priorities, colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

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
    top: Math.min(position.y, window.innerHeight - 500),
  }

  const handleMoveTo = (columnId: string) => {
    updateTask(taskId, { columnId })
    onTaskUpdate?.(taskId, { columnId })
    onClose()
  }

  const handlePriority = (priority: 'low' | 'medium' | 'high' | 'urgent') => {
    updateTask(taskId, { priority })
    onTaskUpdate?.(taskId, { priority })
    onClose()
  }

  const handleColor = (color: string) => {
    updateTask(taskId, { color })
    onTaskUpdate?.(taskId, { color })
    onClose()
  }

  const handleColorNative = (color: string) => {
    addRecentColor(color)
    updateTask(taskId, { color })
    onTaskUpdate?.(taskId, { color })
  }

  const handleCopyId = () => {
    navigator.clipboard.writeText(taskId)
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
        initial={{ opacity: 0, scale: 0.92, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className={cn(
          'fixed z-[200] min-w-[260px] max-h-[80vh] overflow-y-auto',
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
          icon={MoveRight}
          label="Move to..."
          hasSubmenu
          isActive={submenu === 'move'}
          onClick={() => setSubmenu(submenu === 'move' ? null : 'move')}
          glowColor={colors.glowColor}
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

        <ContextMenuButton
          icon={Flag}
          label="Priority"
          hasSubmenu
          isActive={submenu === 'priority'}
          onClick={() => setSubmenu(submenu === 'priority' ? null : 'priority')}
          glowColor={colors.glowColor}
        />
        {submenu === 'priority' && (
          <div className="pl-2 border-l border-white/10 ml-3 space-y-0.5 py-1">
            {priorities.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePriority(p.id as 'low' | 'medium' | 'high' | 'urgent')}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-white/10',
                  task.priority === p.id ? 'bg-white/10 font-medium' : ''
                )}
                style={{ color: p.color }}
              >
                <Flag className="w-3 h-3" />
                {p.name.charAt(0).toUpperCase() + p.name.slice(1)}
              </button>
            ))}
          </div>
        )}

        <ContextMenuButton
          icon={Palette}
          label="Color"
          hasSubmenu
          isActive={submenu === 'color'}
          onClick={() => setSubmenu(submenu === 'color' ? null : 'color')}
          glowColor={colors.glowColor}
        />
        {submenu === 'color' && (() => {
          const recent = getRecentColors()
          return (
          <div className="px-3 py-2 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => handleColor(c)}
                  className={cn(
                    'w-7 h-7 rounded-full border-2 transition-all',
                    task.color === c ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                  )}
                  style={{ backgroundColor: colorConfig[c].hex }}
                />
              ))}
            </div>
            {recent.length > 0 && (
              <div className="border-t border-white/10 pt-2">
                <span className="text-[10px] text-slate-500 mb-1 block">Recent</span>
                <div className="flex gap-1.5 flex-wrap">
                  {recent.map((hex) => (
                    <button
                      key={hex}
                      onClick={() => handleColor(hex)}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all',
                        task.color === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="border-t border-white/10 pt-2">
              <div className="grid grid-cols-7 gap-1">
                {PALETTE_COLORS.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => handleColor(hex)}
                    className={cn(
                      'w-7 h-7 rounded-full border-2 transition-all',
                      task.color === hex ? 'border-white scale-110' : 'border-transparent hover:border-white/40'
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
                    value={task.color?.startsWith('#') ? task.color : colorConfig[task.color as AccentColor]?.hex ?? '#a855f7'}
                    onChange={(e) => handleColorNative(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div
                    className="w-7 h-7 rounded-full border-2 border-dashed border-white/30 group-hover:border-white/60 transition-all flex items-center justify-center"
                    style={{ backgroundColor: task.color?.startsWith('#') ? task.color : 'transparent' }}
                  >
                    {!task.color?.startsWith('#') && <Palette className="w-3 h-3 text-slate-400" />}
                  </div>
                </div>
                <span className="text-[11px] text-slate-500 group-hover:text-slate-300 transition-colors">Custom</span>
              </label>
            </div>
          </div>
          )
        })()}

        <ContextMenuButton
          icon={FolderInput}
          label="Copy to Project..."
          hasSubmenu
          isActive={submenu === 'transfer' && transferMode === 'copy'}
          onClick={() => {
            setTransferMode('copy')
            if (submenu === 'transfer') { setSubmenu(null); return }
            setSubmenu('transfer')
            if (transferProjects.length === 0) {
              setTransferLoading(true)
              listProjectsForTransfer()
                .then(setTransferProjects)
                .catch(() => {})
                .finally(() => setTransferLoading(false))
            }
          }}
          glowColor={colors.glowColor}
        />
        <ContextMenuButton
          icon={MoveRight}
          label="Move to Project..."
          hasSubmenu
          isActive={submenu === 'transfer' && transferMode === 'move'}
          onClick={() => {
            setTransferMode('move')
            if (submenu === 'transfer') { setSubmenu(null); return }
            setSubmenu('transfer')
            if (transferProjects.length === 0) {
              setTransferLoading(true)
              listProjectsForTransfer()
                .then(setTransferProjects)
                .catch(() => {})
                .finally(() => setTransferLoading(false))
            }
          }}
          glowColor={colors.glowColor}
        />
        {submenu === 'transfer' && (
          <div className="pl-2 border-l border-white/10 ml-3 space-y-0.5 py-1">
            {transferLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading...
              </div>
            ) : transferProjects.filter((p) => p.id !== task.projectId).length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">No other projects</div>
            ) : (
              transferProjects
                .filter((p) => p.id !== task.projectId)
                .map((project) => (
                  <div key={project.id}>
                    <button
                      onClick={() => setSelectedProjectId(selectedProjectId === project.id ? null : project.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors',
                        selectedProjectId === project.id ? 'text-white bg-white/10' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      )}
                    >
                      <ArrowRight className={cn('w-3 h-3 text-slate-500 transition-transform', selectedProjectId === project.id && 'rotate-90')} />
                      {project.name}
                    </button>
                    {selectedProjectId === project.id && (
                      <div className="pl-4 space-y-0.5 py-1 border-l border-white/10 ml-5">
                        {project.columns.map((col) => (
                          <button
                            key={col.id}
                            onClick={async () => {
                              try {
                                if (transferMode === 'copy') {
                                  await copyTaskToProject(taskId, task.projectId, project.id, col.id)
                                } else {
                                  removeTask(taskId)
                                  await moveTaskToProject(taskId, task.projectId, project.id, col.id)
                                }
                              } catch {}
                              onClose()
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-white rounded-md transition-colors"
                          >
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
                            {col.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}

        <button
          onClick={handleCopyId}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Copy className="w-4 h-4" />
          Copy ID
        </button>

        {onArchiveTask && (
          <button
            onClick={() => { onArchiveTask(taskId); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/10 transition-colors"
            style={{
              textShadow: `0 0 ${8 * mult}px rgba(245,158,11,${0.4 * mult})`,
            }}
          >
            <Package className="w-4 h-4" />
            Archive
          </button>
        )}

        {onSendToVault && (
          <button
            onClick={() => {
              if (task.status !== 'done') return
              onSendToVault(taskId)
              onClose()
            }}
            disabled={task.status !== 'done'}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
              task.status === 'done'
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-600 cursor-not-allowed'
            )}
            style={task.status === 'done' ? {
              textShadow: `0 0 ${8 * mult}px rgba(16,185,129,${0.4 * mult})`,
            } : undefined}
          >
            <Archive className="w-4 h-4" />
            Send to Vault
          </button>
        )}

        {!task.onTimeline && onPushToGantt && (
          <button
            onClick={() => { onPushToGantt(task.id); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Calendar className="w-4 h-4 text-cyan-400" />
            Push to Gantt
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

