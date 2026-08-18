'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useBoardSizing, sizingTooltip, sizingUnitLabel } from './sizing'
import { anchorToCard } from './popoverAnchor'

interface TaskSizePopoverProps {
  taskId: string
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>, options?: { silent?: boolean }) => void
}

const POPOVER_WIDTH = 232
const POPOVER_HEIGHT = 104

export function TaskSizePopover({ taskId, onClose, onTaskUpdate }: TaskSizePopoverProps) {
  const task = useBoardStore((s) => s.tasks.find((t) => t.id === taskId))
  const updateTask = useBoardStore((s) => s.updateTask)
  const sizing = useBoardSizing()
  const [position, setPosition] = useState(() => anchorToCard(taskId, POPOVER_WIDTH, POPOVER_HEIGHT))
  const [draft, setDraft] = useState(() => (task?.size ?? '') as number | '')
  const containerRef = useRef<HTMLDivElement>(null)

  const apply = (size: number | null) => {
    if (size !== (task?.size ?? null)) {
      updateTask(taskId, { size })
      onTaskUpdate?.(taskId, { size }, { silent: true })
    }
    onClose()
  }

  useEffect(() => {
    const reposition = () => setPosition(anchorToCard(taskId, POPOVER_WIDTH, POPOVER_HEIGHT))
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [taskId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [onClose])

  // The card can vanish under us (deleted by a teammate via realtime sync);
  // closing keeps the capture-phase Escape handler from outliving it.
  useEffect(() => {
    if (!task) onClose()
  }, [task, onClose])

  if (!task) return null

  const body = (
    <div
      ref={containerRef}
      className="fixed z-[60] p-3 space-y-2 glass-elevated"
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
        background: 'linear-gradient(var(--surface-tint), var(--surface-tint)), var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 12px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Size
        </span>
        {task.size !== null && task.size !== undefined && (
          <button
            onClick={() => apply(null)}
            className="text-[10px] hover:text-white transition-colors"
            style={{ color: 'var(--text-dim)' }}
          >
            Clear
          </button>
        )}
      </div>

      {sizing.enabled && (
        <div className="flex flex-wrap gap-1.5">
          {sizing.labels.map((label) => {
            const isActive = task.size === label.value
            return (
              <button
                key={label.key}
                onClick={() => apply(label.value)}
                title={sizingTooltip(sizing, label)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150',
                  isActive
                    ? 'bg-white/10 border-white/30 text-white'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
                )}
                style={isActive ? { boxShadow: '0 0 8px color-mix(in srgb, var(--primary) 45%, transparent)' } : undefined}
              >
                {label.key}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0.5}
          max={20}
          step={0.5}
          value={draft}
          autoFocus
          placeholder="Auto"
          onChange={(e) => setDraft(e.target.value === '' ? '' : Number(e.target.value))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') apply(draft === '' ? null : Number(draft))
            if (e.key === 'Escape') onClose()
          }}
          className="w-16 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-white/25"
        />
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
          {draft === '' ? `custom ${sizing.unit}` : sizingUnitLabel(sizing.unit, Number(draft))}
        </span>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
