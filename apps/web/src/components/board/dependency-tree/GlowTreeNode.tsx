'use client'

import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { resolveColor } from '@/lib/utils/colors'
import { useBoardStore } from '@/lib/store/boardStore'

type TriState = 'unchecked' | 'checked' | 'crossed'

function nextTriState(current: TriState): TriState {
  if (current === 'unchecked') return 'checked'
  if (current === 'checked') return 'crossed'
  return 'unchecked'
}

function triStateToStatus(state: TriState, fallbackStatus: string): string {
  if (state === 'checked') return 'done'
  if (state === 'crossed') return 'todo'
  return fallbackStatus === 'done' ? 'todo' : fallbackStatus
}

interface GlowTreeNodeProps {
  id: string
  x: number
  y: number
  width: number
  height: number
  name: string
  status: string
  priority: string
  color: string
  isFocused: boolean
  isRoot?: boolean
  level: number
  indexInLevel: number
  onNodeClick?: (id: string) => void
  onNodeDoubleClick?: (id: string) => void
  onStatusChange?: (id: string, status: string) => void
}

const statusBadgeColors: Record<string, string> = {
  todo: 'bg-pink-500/20 text-pink-400',
  doing: 'bg-blue-500/20 text-blue-400',
  review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-emerald-500/20 text-emerald-400',
}

const priorityBadgeColors: Record<string, string> = {
  low: 'bg-slate-500/20 text-slate-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  urgent: 'bg-red-500/20 text-red-400',
}

export function GlowTreeNode({
  id,
  x,
  y,
  width,
  height,
  name,
  status,
  priority,
  color,
  isFocused,
  isRoot = false,
  level,
  indexInLevel,
  onNodeClick,
  onNodeDoubleClick,
  onStatusChange,
}: GlowTreeNodeProps) {
  const resolved = resolveColor(color)
  const delay = level * 0.1 + indexInLevel * 0.05
  const crossedTaskIds = useBoardStore((s) => s.crossedTaskIds)
  const addCrossedTask = useBoardStore((s) => s.addCrossedTask)
  const removeCrossedTask = useBoardStore((s) => s.removeCrossedTask)
  const triState: TriState = status === 'done' ? 'checked' : id in crossedTaskIds ? 'crossed' : 'unchecked'

  const handleCheckClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = nextTriState(triState)
    if (next === 'crossed') {
      addCrossedTask(id)
    } else {
      removeCrossedTask(id)
    }
    onStatusChange?.(id, triStateToStatus(next, status))
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, x: -20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ delay, duration: 0.3, ease: 'easeOut' }}
      className="absolute cursor-pointer"
      style={{ left: x, top: y, width, height }}
      onClick={() => onNodeClick?.(id)}
      onDoubleClick={() => onNodeDoubleClick?.(id)}
    >
      <div
        className={cn(
          'h-full rounded-xl overflow-hidden flex',
          'border transition-all duration-300',
          isFocused ? 'border-white/30' : isRoot ? 'border-white/20' : 'border-white/10'
        )}
        style={{
          backgroundColor: isFocused ? 'rgba(30, 32, 45, 0.97)' : 'rgba(18, 20, 30, 0.97)',
          boxShadow: isFocused
            ? `0 0 30px 8px ${resolved.glow}, 0 0 60px 15px ${resolved.glowDark}`
            : isRoot
              ? `0 0 22px 5px ${resolved.glow}, 0 0 40px 10px ${resolved.glowDark}`
              : `0 0 15px 3px ${resolved.glowDark}`,
        }}
      >
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: resolved.hex }}
        />

        <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
          <div className="flex items-start gap-2">
            <button
              onClick={handleCheckClick}
              className={cn(
                'flex-shrink-0 w-5 h-5 rounded border-2 mt-0.5 transition-all duration-300',
                'flex items-center justify-center',
                triState === 'checked' && 'bg-emerald-500 border-emerald-400',
                triState === 'crossed' && 'bg-red-500 border-red-400',
                triState === 'unchecked' && 'border-white/30 hover:border-white/50'
              )}
              style={{
                boxShadow:
                  triState === 'checked'
                    ? '0 0 12px rgba(16,185,129,0.6), 0 0 24px rgba(16,185,129,0.3)'
                    : triState === 'crossed'
                      ? '0 0 12px rgba(239,68,68,0.6), 0 0 24px rgba(239,68,68,0.3)'
                      : undefined,
              }}
            >
              {triState === 'checked' && <Check className="w-3 h-3 text-white" />}
              {triState === 'crossed' && <X className="w-3 h-3 text-white" />}
            </button>

            <p className={cn(
              'text-sm font-medium line-clamp-2',
              triState === 'checked' && 'line-through text-slate-500',
              triState === 'crossed' && 'line-through text-red-400/50',
              triState === 'unchecked' && 'text-white',
            )}>
              {name}
            </p>
          </div>

          <div className="flex items-center gap-1.5 mt-auto">
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', statusBadgeColors[status])}>
              {status}
            </span>
            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', priorityBadgeColors[priority])}>
              {priority}
            </span>
            <div
              className="w-2 h-2 rounded-full ml-auto shrink-0"
              style={{ backgroundColor: resolved.hex }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
