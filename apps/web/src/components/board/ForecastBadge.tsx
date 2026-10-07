'use client'

import { useEffect } from 'react'
import { TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { useForecastStore } from '@/lib/store/forecastStore'
import type { CardForecast } from '@/lib/schedule/forecast'

const TONE: Record<CardForecast['status'], string> = {
  on_track: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  no_due_date: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  at_risk: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  late: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export function formatLikely(iso: string): string {
  return `Likely ${new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`
}

/** "Likely Fri 10 Oct" for a card with a forecast; the reason sits in the tooltip. */
export function ForecastBadge({ taskId }: { taskId: string }) {
  const projectId = useBoardStore((s) => s.columns[0]?.projectId)
  const forecast = useForecastStore((s) => s.byTaskId[taskId])
  const acquire = useForecastStore((s) => s.acquire)

  useEffect(() => {
    if (!projectId) return
    return acquire(projectId)
  }, [projectId, acquire])

  if (!forecast) return null
  const label = formatLikely(forecast.forecastEnd)
  const tooltip = forecast.confidence === 'low' ? `${forecast.reason} (low confidence)` : forecast.reason

  return (
    <span
      data-testid="forecast-badge"
      data-status={forecast.status}
      title={tooltip}
      aria-label={`${label}. ${tooltip}`}
      className={cn(
        'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border whitespace-nowrap',
        TONE[forecast.status],
        forecast.confidence === 'low' && 'opacity-70',
      )}
    >
      <TrendingUp className="w-3 h-3" />
      {label}
    </span>
  )
}
