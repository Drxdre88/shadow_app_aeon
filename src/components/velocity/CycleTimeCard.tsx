'use client'

import { motion } from 'framer-motion'
import { Clock, Gauge, TrendingUp, Target } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface CycleTimeCardProps {
  avgDays: number | null
  medianDays: number | null
  p95Days: number | null
  totalCompleted: number
  priorities: { priority: string; count: number; avgDays: number | null }[]
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const statVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } },
}

const priorityColors: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-blue-400',
  low: 'text-slate-400',
}

const priorityBg: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-500',
}

function formatDays(days: number | null): string {
  if (days === null) return 'N/A'
  if (days < 1) return '<1d'
  return `${days}d`
}

export function CycleTimeCard({ avgDays, medianDays, p95Days, totalCompleted, priorities }: CycleTimeCardProps) {
  const cardClass = 'backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4'
  const priorityTotal = priorities.reduce((sum, p) => sum + p.count, 0)

  return (
    <motion.div
      className="grid grid-cols-4 gap-3"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Completed</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{totalCompleted}</div>
        <div className="text-xs text-amber-400/70 mt-1">tasks in range</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Avg / Median</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{formatDays(avgDays)}</div>
        <div className="text-xs text-amber-400/70 mt-1">median {formatDays(medianDays)}</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Gauge className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">P95</span>
        </div>
        <div className="text-3xl font-bold text-white tabular-nums">{formatDays(p95Days)}</div>
        <div className="text-xs text-amber-400/70 mt-1">95th percentile</div>
      </motion.div>

      <motion.div variants={statVariants} className={cardClass}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Target className="w-4 h-4 text-amber-400" />
          </div>
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">By Priority</span>
        </div>
        {priorityTotal > 0 ? (
          <div className="space-y-1.5">
            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const entry = priorities.find(pr => pr.priority === p)
                const pct = entry ? (entry.count / priorityTotal) * 100 : 0
                if (pct === 0) return null
                return (
                  <div
                    key={p}
                    className={cn('h-full', priorityBg[p])}
                    style={{ width: `${pct}%` }}
                    title={`${p}: ${entry?.count ?? 0} (avg ${formatDays(entry?.avgDays ?? null)})`}
                  />
                )
              })}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
                const entry = priorities.find(pr => pr.priority === p)
                if (!entry || entry.count === 0) return null
                return (
                  <span key={p} className={cn('text-[10px] font-medium', priorityColors[p])}>
                    {p.charAt(0).toUpperCase()}: {entry.count}
                  </span>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-sm">-</div>
        )}
      </motion.div>
    </motion.div>
  )
}
