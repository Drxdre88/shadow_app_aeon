'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Flame, TrendingUp, TrendingDown, Minus, Hourglass, Gem } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import type { StreakStats, MonthComparison } from './trophy-stats'

interface TrophyHeroProps {
  total: number
  thisWeek: number
  avgDays: number | null
  weekStreak: StreakStats
  months: MonthComparison
  effortBanked: number
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
}: TrophyHeroProps) {
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75
  const gold = goldText(colors.isDark)

  const tileStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
  }

  const delta = months.deltaPct
  const DeltaIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  const deltaColor = delta === null || delta === 0 ? colors.textDim : delta > 0 ? colors.success : colors.warning

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {/* Medallion tile — the vault's centrepiece */}
      <motion.div
        custom={0}
        variants={tileVariants}
        initial="hidden"
        animate="show"
        className="col-span-2 md:col-span-1 xl:col-span-1 relative overflow-hidden rounded-2xl p-4 flex items-center gap-4 backdrop-blur-xl"
        style={{
          ...tileStyle,
          background: `linear-gradient(135deg, ${hexAlpha(GOLD.base, colors.isDark ? 0.12 : 0.08)}, ${colors.surface} 65%)`,
          borderColor: hexAlpha(GOLD.base, 0.3),
        }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{
            background: `linear-gradient(140deg, ${hexAlpha(GOLD.bright, 0.3)}, ${hexAlpha(GOLD.deep, 0.25)})`,
            border: `1px solid ${hexAlpha(GOLD.base, 0.5)}`,
            boxShadow: glowIntensity > 0 ? `0 0 ${18 * mult}px ${4 * mult}px ${GOLD.glow}` : undefined,
          }}
        >
          <Trophy className="w-6 h-6" style={{ color: gold }} />
        </div>
        <div className="min-w-0">
          <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: colors.text }}>
            {total}
          </div>
          <div className="text-[10px] uppercase tracking-widest font-semibold mt-1.5" style={{ color: gold }}>
            Trophies
          </div>
        </div>
      </motion.div>

      {/* This month vs last */}
      <motion.div custom={1} variants={tileVariants} initial="hidden" animate="show" className="rounded-2xl p-4 backdrop-blur-xl" style={tileStyle}>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: colors.text }}>{months.thisMonth}</span>
          <span className="flex items-center gap-0.5 text-xs font-semibold tabular-nums" style={{ color: deltaColor }}>
            <DeltaIcon className="w-3.5 h-3.5" />
            {delta === null ? 'new' : `${delta > 0 ? '+' : ''}${delta}%`}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-semibold mt-2" style={{ color: colors.textDim }}>
          This month <span className="normal-case tracking-normal font-normal">· {months.lastMonth} last</span>
        </div>
      </motion.div>

      {/* Week streak */}
      <motion.div custom={2} variants={tileVariants} initial="hidden" animate="show" className="rounded-2xl p-4 backdrop-blur-xl" style={tileStyle}>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: colors.text }}>{weekStreak.current}</span>
          <Flame className="w-4 h-4 self-center" style={{ color: weekStreak.current > 0 ? gold : colors.textDim }} />
          <span className="text-xs tabular-nums" style={{ color: colors.textDim }}>best {weekStreak.best}</span>
        </div>
        <div className="text-[10px] uppercase tracking-widest font-semibold mt-2" style={{ color: colors.textDim }}>
          Week streak
        </div>
      </motion.div>

      {/* This week */}
      <motion.div custom={3} variants={tileVariants} initial="hidden" animate="show" className="rounded-2xl p-4 backdrop-blur-xl" style={tileStyle}>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: colors.text }}>{thisWeek}</span>
          <Gem className="w-3.5 h-3.5 self-center" style={{ color: gold }} />
        </div>
        <div className="text-[10px] uppercase tracking-widest font-semibold mt-2" style={{ color: colors.textDim }}>
          Last 7 days
        </div>
      </motion.div>

      {/* Avg days + effort banked */}
      <motion.div custom={4} variants={tileVariants} initial="hidden" animate="show" className="rounded-2xl p-4 backdrop-blur-xl" style={tileStyle}>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: colors.text }}>
            {avgDays !== null ? `${avgDays}d` : '—'}
          </span>
          <Hourglass className="w-3.5 h-3.5 self-center" style={{ color: colors.textDim }} />
        </div>
        <div className="text-[10px] uppercase tracking-widest font-semibold mt-2" style={{ color: colors.textDim }}>
          Avg to finish{effortBanked > 0 && (
            <span className="normal-case tracking-normal font-normal"> · {effortBanked}d banked</span>
          )}
        </div>
      </motion.div>
    </div>
  )
})
