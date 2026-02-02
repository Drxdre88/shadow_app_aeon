'use client'

import { useMemo } from 'react'
import { format, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns'
import { cn } from '@/lib/utils/cn'

interface TimelineHeaderProps {
  startDate: Date
  endDate: Date
  timeScale: 'day' | 'week' | 'month'
  cellWidth: number
}

export function TimelineHeader({ startDate, endDate, timeScale, cellWidth }: TimelineHeaderProps) {
  const columns = useMemo(() => {
    switch (timeScale) {
      case 'day':
        return eachDayOfInterval({ start: startDate, end: endDate }).map((date) => ({
          date,
          label: format(date, 'EEE d'),
          subLabel: format(date, 'MMM'),
        }))
      case 'week':
        return eachWeekOfInterval({ start: startDate, end: endDate }).map((date) => ({
          date,
          label: format(date, 'MMM d'),
          subLabel: `Week ${format(date, 'I')}`,
        }))
      case 'month':
        return eachMonthOfInterval({ start: startDate, end: endDate }).map((date) => ({
          date,
          label: format(date, 'MMMM'),
          subLabel: format(date, 'yyyy'),
        }))
    }
  }, [startDate, endDate, timeScale])

  return (
    <div className="sticky top-0 z-20 bg-white/5 backdrop-blur-xl border-b border-white/10">
      <div className="flex">
        <div className="w-48 flex-shrink-0 px-4 py-3 border-r border-white/10">
          <span className="text-sm font-medium text-slate-400">Resources</span>
        </div>
        <div className="flex">
          {columns.map((col, i) => (
            <div
              key={i}
              className={cn(
                'flex-shrink-0 px-2 py-2 border-r border-white/5 text-center',
                i % 2 === 0 && 'bg-white/[0.02]'
              )}
              style={{ width: cellWidth }}
            >
              <div className="text-xs text-slate-500">{col.subLabel}</div>
              <div className="text-sm font-medium text-slate-300">{col.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
