'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Flame, TrendingUp, TrendingDown, Minus, Hourglass, Gem, Sparkles } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { formatCount, formatDays, type StreakStats, type MonthComparison } from './trophy-stats'
import { useChartMotion } from './trophy-chart-kit'

interface TrophyHeroProps {
  total: number
  thisWeek: number
  avgDays: number | null
  weekStreak: StreakStats
  months: MonthComparison
  effortBanked: number
  /** Trophies landed since the vault was last opened on this device; null on a first visit. */
  sinceLastVisit?: number | null
}

const tileVariants = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 24, delay: i * 0.05 },
  }),
}

export const TrophyHero = memo(function TrophyHero({
  total,
  thisWeek,
  avgDays,
  weekStreak,
  months,
  effortBanked,
  sinceLastVisit = null,
}: TrophyHeroProps) {
  const { colors, glowIntensity } = useThemeStore()
  const animate = useChartMotion()
  const mult = glowIntensity / 75
  const gold = goldText(colors.isDark)

  const tileClass =
    'rounded-2xl p-3 backdrop-blur-xl transition-shadow duration-200 hover:shadow-[0_0_0_1px_rgba(245,158,11,0.28)]'
  const tileStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
  }
  const labelClass = 'text-[10px] uppercase tracking-widest font-semibold mt-1.5'

  const delta = months.deltaPct
  const DeltaIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  const deltaColor = delta === null || delta === 0 ? colors.textDim : delta > 0 ? colors.success : colors.warning

  const tile = (i: number, className: string, style: React.CSSProperties = tileStyle) => ({
    custom: i,
    variants: tileVariants,
    initial: animate ? ('hidden' as const) : false,
    animate: 'show' as const,
    className,
    style,
  })

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {/* Medallion tile — the vault's centrepiece */}
      <motion.div
        {...tile(0, `${tileClass} col-span-2 sm:col-span-1 lg:col-span-2 relative overflow-hidden flex items-center gap-3`, {
          ...tileStyle,
          background: `linear-gradient(135deg, ${hexAlpha(GOLD.base, colors.isDark ? 0.12 : 0.08)}, ${colors.surface} 65%)`,
          borderColor: hexAlpha(GOLD.base, 0.3),
        })}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: `linear-gradient(140deg, ${hexAlpha(GOLD.bright, 0.3)}, ${hexAlpha(GOLD.deep, 0.25)})`,
            border: `1px solid ${hexAlpha(GOLD.base, 0.5)}`,
            boxShadow: glowIntensity > 0 ? `0 0 ${18 * mult}px ${4 * mult}px ${GOLD.glow}` : undefined,
          }}
        >
          <Trophy className="w-5 h-5" style={{ color: gold }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-3xl font-bold leading-none" style={{ color: colors.text }}>
            {formatCount(total)}
          </div>
          <div className={labelClass} style={{ color: gold }}>
            Trophies
          </div>
        </div>
        {sinceLastVisit !== null && sinceLastVisit > 0 && (
          <motion.span
            initial={animate ? { opacity: 0, scale: 0.8 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 300, damping: 18 }}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap"
            style={{ background: hexAlpha(GOLD.base, 0.14), color: gold, border: `1px solid ${hexAlpha(GOLD.base, 0.35)}` }}
          >
            <Sparkles className="w-3 h-3" />+{formatCount(sinceLastVisit)} since last visit
          </motion.span>
        )}
      </motion.div>

      {/* This month vs last */}
      <motion.div {...tile(1, tileClass)}>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold" style={{ color: colors.text }}>
            {formatCount(months.thisMonth)}
          </span>
          <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums" style={{ color: deltaColor }}>
            <DeltaIcon className="w-3.5 h-3.5" />
            {delta === null ? 'new' : `${delta > 0 ? '+' : ''}${delta}%`}
          </span>
        </div>
        <div className={labelClass} style={{ color: colors.textDim }}>
          This month <span className="normal-case tracking-normal font-normal">· {formatCount(months.lastMonth)} last</span>
        </div>
      </motion.div>

      {/* Week streak */}
      <motion.div {...tile(2, tileClass)}>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold" style={{ color: colors.text }}>
            {weekStreak.current}
          </span>
          <Flame className="w-4 h-4 self-center" style={{ color: weekStreak.current > 0 ? gold : colors.textDim }} />
          <span className="text-xs tabular-nums" style={{ color: colors.textDim }}>
            best {weekStreak.best}
          </span>
        </div>
        <div className={labelClass} style={{ color: colors.textDim }}>
          Week streak
        </div>
      </motion.div>

      {/* This week */}
      <motion.div {...tile(3, tileClass)}>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold" style={{ color: colors.text }}>
            {formatCount(thisWeek)}
          </span>
          <Gem className="w-3.5 h-3.5 self-center" style={{ color: gold }} />
        </div>
        <div className={labelClass} style={{ color: colors.textDim }}>
          Last 7 days
        </div>
      </motion.div>

      {/* Avg days + effort banked */}
      <motion.div {...tile(4, tileClass)}>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold" style={{ color: colors.text }}>
            {formatDays(avgDays)}
          </span>
          <Hourglass className="w-3.5 h-3.5 self-center" style={{ color: colors.textDim }} />
        </div>
        <div className={labelClass} style={{ color: colors.textDim }}>
          Avg to finish
          {effortBanked > 0 && (
            <span className="normal-case tracking-normal font-normal"> · {formatDays(effortBanked)} banked</span>
          )}
        </div>
      </motion.div>
    </div>
  )
})
