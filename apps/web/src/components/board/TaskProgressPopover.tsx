'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'

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
      className={cn(
        'fixed z-[60] p-3 rounded-xl space-y-2',
        'backdrop-blur-xl bg-[#1a1a24]/95 border border-white/15',
        'shadow-[0_0_30px_rgba(0,0,0,0.6)]'
      )}
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">Progress</span>
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          autoFocus
          onChange={(e) => setValue(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          className="w-14 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-white text-xs text-right focus:outline-none focus:ring-1 focus:ring-white/25"
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>Enter to save</span>
        <button
          onClick={() => { committedRef.current = true; updateTask(taskId, { progress: null }); onTaskUpdate?.(taskId, { progress: null }, { silent: true }); onClose() }}
          className="text-slate-400 hover:text-white transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
