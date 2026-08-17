'use client'

import { cn } from '@/lib/utils/cn'
import { useBoardSizing, sizingLabelFor, sizingUnitLabel } from './sizing'

interface TaskSizeBadgeProps {
  size: number | null | undefined
  className?: string
}

export function TaskSizeBadge({ size, className }: TaskSizeBadgeProps) {
  const sizing = useBoardSizing()
  if (!size) return null

  const key = sizing.enabled ? sizingLabelFor(sizing, size) : null

  return (
    <span
      title={sizing.enabled ? sizingUnitLabel(sizing.unit, size) : undefined}
      className={cn(
        'px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium',
        'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
        className
      )}
    >
      {key ?? (sizing.enabled && sizing.unit === 'points' ? `${size}p` : `${size}d`)}
    </span>
  )
}
