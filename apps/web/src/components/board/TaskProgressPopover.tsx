'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore } from '@/lib/store/boardStore'
import { ProgressControl } from './ProgressControl'

interface TaskProgressPopoverProps {
  taskId: string
  onClose: () => void
  onTaskUpdate?: (taskId: string, updates: Record<string, unknown>, options?: { silent?: boolean }) => void
}

const POPOVER_WIDTH = 208
const POPOVER_HEIGHT = 96

function anchorPosition(taskId: string) {
  if (typeof document === 'undefined') return { top: 0, left: 0 }
  const card = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)
  const rect = card?.getBoundingClientRect()
  if (!rect || rect.width === 0) {
    return {
      top: Math.round(window.innerHeight / 2 - POPOVER_HEIGHT / 2),
      left: Math.round(window.innerWidth / 2 - POPOVER_WIDTH / 2),
    }
  }
  const top = rect.bottom + 8 + POPOVER_HEIGHT > window.innerHeight
    ? Math.max(8, rect.top - POPOVER_HEIGHT - 8)
    : rect.bottom + 8
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8)
  return { top: Math.round(top), left: Math.round(left) }
}

export function TaskProgressPopover({ taskId, onClose, onTaskUpdate }: TaskProgressPopoverProps) {
  const task = useBoardStore((s) => s.tasks.find((t) => t.id === taskId))
  const updateTask = useBoardStore((s) => s.updateTask)
  const [value, setValue] = useState(() => task?.progress ?? 0)
  const [position, setPosition] = useState(() => anchorPosition(taskId))
  const containerRef = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  const commit = (next: number) => {
    if (committedRef.current) return
    committedRef.current = true
    const clamped = Math.min(100, Math.max(0, Math.round(next)))
    if (clamped !== (task?.progress ?? null)) {
      updateTask(taskId, { progress: clamped })
      onTaskUpdate?.(taskId, { progress: clamped }, { silent: true })
    }
    onClose()
  }

  const cancel = () => {
    committedRef.current = true
    onClose()
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(valueRef.current) }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commit(valueRef.current)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track the anchor card through scroll/reflow so the popover stays attached.
  useEffect(() => {
    const reposition = () => setPosition(anchorPosition(taskId))
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [taskId])

  // The task can vanish under us (deleted by a teammate via realtime sync).
  // Without this, the popover renders null but its capture-phase key handlers
  // stay alive and eat Escape board-wide until navigation.
  useEffect(() => {
    if (!task) { committedRef.current = true; onClose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])

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
      <span className="block text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Progress
      </span>
      <ProgressControl value={value} onChange={setValue} autoFocus />
      <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-dim)' }}>
        <span>Enter to save</span>
        <button
          onClick={() => { committedRef.current = true; updateTask(taskId, { progress: null }); onTaskUpdate?.(taskId, { progress: null }, { silent: true }); onClose() }}
          className="hover:text-white transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          Clear
        </button>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
