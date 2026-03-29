'use client'

import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface StaleIndicatorProps {
  updatedAt?: string
  status?: string
  staleDays?: number
}

export function StaleIndicator({ updatedAt, status, staleDays = 7 }: StaleIndicatorProps) {
  if (!updatedAt || status === 'done') return null

  const daysSince = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (daysSince < staleDays) return null

  return (
    <span
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium',
        'bg-amber-500/15 text-amber-400/80 border border-amber-500/20'
      )}
    >
      <Clock className="w-3 h-3" />
      {daysSince}d
    </span>
  )
}
