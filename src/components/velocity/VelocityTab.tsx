'use client'

import { useState, useEffect, useCallback } from 'react'
import { getVelocityStats } from '@/lib/actions/velocity'
import type { VelocityRange } from '@/lib/data/velocity'
import { VelocityChart } from './VelocityChart'
import { CycleTimeCard } from './CycleTimeCard'
import { HeatmapGrid } from './HeatmapGrid'
import { ColumnFlowBar } from './ColumnFlowBar'
import { cn } from '@/lib/utils/cn'

type VelocityData = Awaited<ReturnType<typeof getVelocityStats>>

const RANGES: { value: VelocityRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

interface VelocityTabProps {
  projectId: string
}

export function VelocityTab({ projectId }: VelocityTabProps) {
  const [range, setRange] = useState<VelocityRange>('30d')
  const [data, setData] = useState<VelocityData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const stats = await getVelocityStats(projectId, range)
      setData(stats)
    } catch {
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, range])

  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={cn(
              'px-3 py-1 rounded-lg text-xs font-medium border transition-all duration-200',
              range === r.value
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-slate-300 hover:bg-white/[0.07]'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
          <div className="h-48 rounded-xl bg-white/[0.03] animate-pulse" />
        </div>
      ) : data ? (
        <>
          <CycleTimeCard
            avgDays={data.cycleTime.avgDays}
            medianDays={data.cycleTime.medianDays}
            p95Days={data.cycleTime.p95Days}
            totalCompleted={data.cycleTime.totalCompleted}
            priorities={data.priorities}
          />

          <div className="grid grid-cols-2 gap-4">
            <VelocityChart data={data.velocity} range={range} />
            <HeatmapGrid data={data.heatmap} />
          </div>

          <ColumnFlowBar data={data.dwellTimes} />
        </>
      ) : (
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          No velocity data available
        </div>
      )}
    </div>
  )
}
