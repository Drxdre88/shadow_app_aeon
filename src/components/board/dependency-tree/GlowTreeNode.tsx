'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils/cn'
import { colorConfig, AccentColor } from '@/lib/utils/colors'

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
  level: number
  indexInLevel: number
}

const statusGlowColors: Record<string, string> = {
  todo: 'rgba(236, 72, 153, 0.5)',
  doing: 'rgba(59, 130, 246, 0.5)',
  review: 'rgba(168, 85, 247, 0.5)',
  done: 'rgba(16, 185, 129, 0.5)',
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
  level,
  indexInLevel,
}: GlowTreeNodeProps) {
  const glowColor = statusGlowColors[status] || statusGlowColors.todo
  const accentColors = colorConfig[color as AccentColor] || colorConfig.purple
  const delay = level * 0.1 + indexInLevel * 0.05

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: 'easeOut' }}
      className="absolute"
      style={{ left: x, top: y, width, height }}
    >
      <div
        className={cn(
          'h-full rounded-xl p-3 flex flex-col justify-between',
          'backdrop-blur-xl border',
          'transition-all duration-300',
          isFocused
            ? 'bg-white/15 border-white/30'
            : 'bg-white/8 border-white/10'
        )}
        style={{
          boxShadow: isFocused
            ? `0 0 30px 8px ${glowColor}, 0 0 60px 15px ${glowColor}`
            : `0 0 15px 3px ${glowColor}`,
        }}
      >
        <p className="text-sm font-medium text-white line-clamp-1">{name}</p>

        <div className="flex items-center gap-1.5 mt-auto">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', statusBadgeColors[status])}>
            {status}
          </span>
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium capitalize', priorityBadgeColors[priority])}>
            {priority}
          </span>
          <div
            className="w-2 h-2 rounded-full ml-auto"
            style={{ backgroundColor: accentColors.hex }}
          />
        </div>
      </div>
    </motion.div>
  )
}
