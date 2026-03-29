'use client'

import { motion } from 'framer-motion'
import { Trophy, Zap, Target, TrendingUp } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

interface TrophyStatsProps {
  totalCompleted: number
  byPriority: Record<string, number>
  completedThisWeek: number
  avgCompletionDays: number | null
}

const prioritySegmentColors = {
  urgent: { bg: 'bg-red-500', label: 'U', title: 'Urgent' },
  high: { bg: 'bg-orange-500', label: 'H', title: 'High' },
  medium: { bg: 'bg-blue-500', label: 'M', title: 'Medium' },
  low: { bg: 'bg-slate-500', label: 'L', title: 'Low' },
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const statVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } },
}

export function TrophyStats({ totalCompleted, byPriority, completedThisWeek, avgCompletionDays }: TrophyStatsProps) {
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const emeraldGlow = `0 0 ${20 * mult}px ${4 * mult}px rgba(16,185,129,0.25)`
  const cardStyle = {
    boxShadow: [emeraldGlow, 'inset 0 1px 0 0 rgba(255,255,255,0.08)', '0 8px 32px rgba(0,0,0,0.3)']
      .filter(Boolean)
      .join(', '),
  }

  const priorityTotal = Object.values(byPriority).reduce((a, b) => a + b, 0)

  return (
    <motion.div
      className="grid grid-cols-4 gap-3"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div
        variants={statVariants}
        className="backdrop-blur-xl bg-white/[0.06] border border-emerald-500/20 rounded-xl p-4"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{totalCompleted}</div>
        <div className="text-xs text-emerald-400/70 mt-1">trophies earned</div>
      </motion.div>

      <motion.div
        variants={statVariants}
        className="backdrop-blur-xl bg-white/[0.06] border border-emerald-500/20 rounded-xl p-4"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">This Week</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{completedThisWeek}</div>
        <div className="text-xs text-emerald-400/70 mt-1">last 7 days</div>
      </motion.div>

      <motion.div
        variants={statVariants}
        className="backdrop-blur-xl bg-white/[0.06] border border-emerald-500/20 rounded-xl p-4"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">By Priority</span>
        </div>
        {priorityTotal > 0 ? (
          <div className="space-y-1.5">
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const count = byPriority[p] ?? 0
                const pct = priorityTotal > 0 ? (count / priorityTotal) * 100 : 0
                if (pct === 0) return null
                return (
                  <div
                    key={p}
                    className={cn('h-full', prioritySegmentColors[p].bg)}
                    style={{ width: `${pct}%` }}
                    title={`${prioritySegmentColors[p].title}: ${count}`}
                  />
                )
              })}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const count = byPriority[p] ?? 0
                if (count === 0) return null
                return (
                  <span key={p} className={cn('text-[10px] font-medium', p === 'urgent' ? 'text-red-400' : p === 'high' ? 'text-orange-400' : p === 'medium' ? 'text-blue-400' : 'text-slate-400')}>
                    {prioritySegmentColors[p].label}: {count}
                  </span>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-sm">—</div>
        )}
      </motion.div>

      <motion.div
        variants={statVariants}
        className="backdrop-blur-xl bg-white/[0.06] border border-emerald-500/20 rounded-xl p-4"
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Avg Time</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">
          {avgCompletionDays !== null ? avgCompletionDays : 'N/A'}
        </div>
        <div className="text-xs text-emerald-400/70 mt-1">
          {avgCompletionDays !== null ? 'days to complete' : 'no data yet'}
        </div>
      </motion.div>
    </motion.div>
  )
}
