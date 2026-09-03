'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Clock, Timer, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { resolvePriority } from '@/lib/utils/priorities'
import { GOLD, goldText, hexAlpha } from './trophy-theme'
import { trophyDate } from './trophy-stats'
import type { TaskVault } from '@/lib/db/schema'

interface TrophyCardProps {
  vaultTask: TaskVault
  onRestore?: (vaultId: string) => void
  onClick?: (vaultTask: TaskVault) => void
}

export const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 25 },
  },
}

export const TrophyCard = memo(function TrophyCard({ vaultTask, onRestore, onClick }: TrophyCardProps) {
  const { colors, glowIntensity, priorities } = useThemeStore()
  const mult = glowIntensity / 75
  const gold = goldText(colors.isDark)

  const labelSnapshot = (vaultTask.labelSnapshot ?? []) as Array<{ name: string; color: string }>
  const checklistSnapshot = (vaultTask.checklistSnapshot ?? {}) as { total?: number; checked?: number }
  const resolvedPriority = resolvePriority(priorities, vaultTask.priority)

  const archivedDisplay = formatDistanceToNow(trophyDate(vaultTask), { addSuffix: true })

  return (
    <motion.div
      variants={cardVariants}
      onClick={() => onClick?.(vaultTask)}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="cursor-pointer relative rounded-xl p-3 h-full flex flex-col backdrop-blur-xl transition-colors duration-300 group"
      style={{
        background: `linear-gradient(160deg, ${hexAlpha(GOLD.base, colors.isDark ? 0.08 : 0.05)}, ${colors.surface} 55%)`,
        border: `1px solid ${hexAlpha(GOLD.base, 0.22)}`,
        boxShadow: glowIntensity > 0 ? `0 0 ${10 * mult}px ${2 * mult}px ${hexAlpha(GOLD.base, 0.12)}` : undefined,
      }}
    >
      {/* gold accent line */}
      <div
        className="absolute top-0 left-1 right-1 h-[2px] rounded-t-xl"
        style={{
          background: `linear-gradient(90deg, transparent, ${hexAlpha(GOLD.base, 0.7)}, transparent)`,
        }}
      />

      <div className="flex items-start gap-2 mb-2">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
          style={{
            background: `linear-gradient(140deg, ${hexAlpha(GOLD.bright, 0.25)}, ${hexAlpha(GOLD.deep, 0.2)})`,
            border: `1px solid ${hexAlpha(GOLD.base, 0.45)}`,
            boxShadow: glowIntensity > 0 ? `0 0 ${10 * mult}px ${2 * mult}px ${GOLD.glow}` : undefined,
          }}
        >
          <Trophy className="w-3.5 h-3.5" style={{ color: gold }} />
        </div>
        <h4 className="text-sm font-medium leading-snug line-clamp-2 flex-1" style={{ color: colors.text }}>
          {vaultTask.name}
        </h4>
      </div>

      {vaultTask.description && (
        <p className="text-xs line-clamp-2 mb-2 pl-9" style={{ color: colors.textMuted }}>
          {vaultTask.description}
        </p>
      )}

      {labelSnapshot.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2 pl-9">
          {labelSnapshot.map((label, i) => {
            const hex = label.color?.startsWith('#')
              ? label.color
              : colorConfig[label.color as AccentColor]?.hex ?? '#94a3b8'
            return (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium truncate max-w-[120px]"
                style={{
                  backgroundColor: hexToRgba(hex, colors.isDark ? 0.15 : 0.1),
                  border: `1px solid ${hexToRgba(hex, 0.3)}`,
                  color: hex,
                }}
              >
                {label.name}
              </span>
            )
          })}
        </div>
      )}

      <div
        className="flex items-center justify-between pt-2 mt-auto"
        style={{ borderTop: `1px solid ${colors.border}` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize"
            style={{
              color: resolvedPriority.color,
              backgroundColor: hexToRgba(resolvedPriority.color, 0.15),
              border: `1px solid ${hexToRgba(resolvedPriority.color, 0.3)}`,
            }}
          >
            {resolvedPriority.name}
          </span>
          {onRestore && (
            <button
              onClick={(e) => { e.stopPropagation(); onRestore(vaultTask.id) }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150"
              style={{
                color: gold,
                background: hexAlpha(GOLD.base, 0.1),
                border: `1px solid ${hexAlpha(GOLD.base, 0.25)}`,
              }}
            >
              <RotateCcw className="w-3 h-3" />
              Restore
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {checklistSnapshot.total && checklistSnapshot.total > 0 ? (
            <span className="text-[10px] font-mono tabular-nums">
              <span style={{ color: colors.success }}>{checklistSnapshot.checked ?? 0}</span>
              <span style={{ color: colors.textDim }}>/{checklistSnapshot.total}</span>
            </span>
          ) : null}
          {vaultTask.daysTaken !== null && (
            <span className="flex items-center gap-1 text-[10px] tabular-nums" style={{ color: colors.textMuted }}>
              <Timer className="w-3 h-3" />
              {vaultTask.daysTaken}d
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px]" style={{ color: colors.textDim }}>
            <Clock className="w-3 h-3" />
            {archivedDisplay}
          </span>
        </div>
      </div>
    </motion.div>
  )
})
