'use client'

import { Trophy, Zap, Target, TrendingUp } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

interface TrophyStatsProps {
  totalCompleted: number
  byPriority: Record<string, number>
  completedThisWeek: number
  avgCompletionDays: number | null
}

const priorityDot: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-500',
}

export function TrophyStats({ totalCompleted, byPriority, completedThisWeek, avgCompletionDays }: TrophyStatsProps) {
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const priorityTotal = Object.values(byPriority).reduce((a, b) => a + b, 0)

  return (
    <div
      className="flex items-center gap-6 px-4 py-2.5 rounded-xl border backdrop-blur-xl"
      style={{
        background: `${colors.surface}`,
        borderColor: `${colors.border}`,
        boxShadow: `0 0 ${12 * mult}px ${2 * mult}px ${colors.glowColor}, 0 4px 20px rgba(0,0,0,0.3)`,
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${colors.primary}25`, border: `1px solid ${colors.primary}40` }}
        >
          <Trophy className="w-3.5 h-3.5" style={{ color: colors.primary }} />
        </div>
        <div>
          <span className="text-lg font-bold text-white tabular-nums">{totalCompleted}</span>
          <span className="text-[10px] text-slate-500 ml-1.5">total</span>
        </div>
      </div>

      <div className="w-px h-6 bg-white/10" />

      <div className="flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" style={{ color: colors.primary }} />
        <span className="text-sm font-semibold text-white tabular-nums">{completedThisWeek}</span>
        <span className="text-[10px] text-slate-500">this week</span>
      </div>

      <div className="w-px h-6 bg-white/10" />

      <div className="flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5" style={{ color: colors.primary }} />
        <span className="text-sm font-semibold text-white tabular-nums">
          {avgCompletionDays !== null ? `${avgCompletionDays}d` : '--'}
        </span>
        <span className="text-[10px] text-slate-500">avg</span>
      </div>

      {priorityTotal > 0 && (
        <>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5" style={{ color: colors.primary }} />
            <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden w-20">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const count = byPriority[p] ?? 0
                const pct = (count / priorityTotal) * 100
                if (pct === 0) return null
                return (
                  <div
                    key={p}
                    className={cn('h-full', priorityDot[p])}
                    style={{ width: `${pct}%` }}
                    title={`${p}: ${count}`}
                  />
                )
              })}
            </div>
            <div className="flex gap-1.5">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const count = byPriority[p] ?? 0
                if (count === 0) return null
                return (
                  <span key={p} className="flex items-center gap-0.5">
                    <div className={cn('w-1.5 h-1.5 rounded-full', priorityDot[p])} />
                    <span className="text-[10px] text-slate-500 tabular-nums">{count}</span>
                  </span>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
