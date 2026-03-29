'use client'

import { cn } from '@/lib/utils/cn'

interface TaskSizeBadgeProps {
  size: number | null | undefined
  className?: string
}

export function TaskSizeBadge({ size, className }: TaskSizeBadgeProps) {
  if (!size) return null

  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium',
        'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
        className
      )}
    >
      {size}d
    </span>
  )
}
