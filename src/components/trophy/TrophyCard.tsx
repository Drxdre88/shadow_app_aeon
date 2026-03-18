'use client'

import { motion } from 'framer-motion'
import { Trophy, Tag, Clock, Timer, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { GlowCard } from '@/components/ui/GlowCard'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { cn } from '@/lib/utils/cn'
import type { TaskVault } from '@/lib/db/schema'

interface TrophyCardProps {
  vaultTask: TaskVault
  onRestore?: (vaultId: string) => void
}

const priorityBadgeStyles = {
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const priorityAccent: Record<string, AccentColor> = {
  low: 'green',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
}

const priorityGlowRgba: Record<string, string> = {
  low: 'rgba(16,185,129,0.4)',
  medium: 'rgba(59,130,246,0.4)',
  high: 'rgba(249,115,22,0.4)',
  urgent: 'rgba(239,68,68,0.4)',
}

const priorityIconColor: Record<string, string> = {
  low: 'text-emerald-400',
  medium: 'text-blue-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
}

const priorityIconBg: Record<string, string> = {
  low: 'bg-emerald-500/20 border-emerald-500/40',
  medium: 'bg-blue-500/20 border-blue-500/40',
  high: 'bg-orange-500/20 border-orange-500/40',
  urgent: 'bg-red-500/20 border-red-500/40',
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

export function TrophyCard({ vaultTask, onRestore }: TrophyCardProps) {
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  const labelSnapshot = (vaultTask.labelSnapshot ?? []) as Array<{ name: string; color: string }>
  const checklistSnapshot = (vaultTask.checklistSnapshot ?? {}) as { total?: number; checked?: number }
  const accentColor = priorityAccent[vaultTask.priority] ?? 'green'
  const glowRgba = priorityGlowRgba[vaultTask.priority] ?? priorityGlowRgba.low
  const iconColor = priorityIconColor[vaultTask.priority] ?? priorityIconColor.low
  const iconBg = priorityIconBg[vaultTask.priority] ?? priorityIconBg.low

  const archivedDisplay = formatDistanceToNow(new Date(vaultTask.archivedAt), { addSuffix: true })

  return (
    <motion.div variants={cardVariants}>
      <GlowCard accentColor={accentColor} glowIntensity="md" showAccentLine hover className="p-3 h-full">
        <div className="flex items-start gap-2 mb-2">
          <div
            className={cn('flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center mt-0.5', iconBg)}
            style={{
              boxShadow: `0 0 ${12 * mult}px ${3 * mult}px ${glowRgba}`,
            }}
          >
            <Trophy className={cn('w-3.5 h-3.5', iconColor)} />
          </div>
          <h4 className="text-sm font-medium text-white leading-snug line-clamp-2 flex-1">
            {vaultTask.name}
          </h4>
        </div>

        {vaultTask.description && (
          <p className="text-xs text-slate-400 line-clamp-2 mb-2 pl-9">
            {vaultTask.description}
          </p>
        )}

        {labelSnapshot.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2 pl-9">
            {labelSnapshot.map((label, i) => {
              const presetColors = colorConfig[label.color as AccentColor]
              const isCustom = !presetColors
              const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
              return (
                <span
                  key={i}
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1',
                    'backdrop-blur-md border',
                    !isCustom && presetColors?.bg,
                    !isCustom && presetColors?.border,
                    !isCustom && presetColors?.text,
                    isCustom && 'text-white'
                  )}
                  style={
                    isCustom
                      ? {
                          backgroundColor: hexToRgba(hex, 0.15),
                          borderColor: hexToRgba(hex, 0.3),
                          color: hex,
                        }
                      : undefined
                  }
                >
                  <Tag className="w-2.5 h-2.5" />
                  {label.name}
                </span>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-auto">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium border',
                priorityBadgeStyles[vaultTask.priority as keyof typeof priorityBadgeStyles]
              )}
            >
              {vaultTask.priority}
            </span>
            {onRestore && (
              <button
                onClick={(e) => { e.stopPropagation(); onRestore(vaultTask.id) }}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30 transition-all"
              >
                <RotateCcw className="w-3 h-3" />
                Restore
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {checklistSnapshot.total && checklistSnapshot.total > 0 && (
              <span className="text-[10px] font-mono tabular-nums">
                <span className="text-emerald-400">{checklistSnapshot.checked ?? 0}</span>
                <span className="text-slate-600">/</span>
                <span className="text-slate-500">{checklistSnapshot.total}</span>
              </span>
            )}
            {vaultTask.daysTaken !== null && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <Timer className="w-3 h-3" />
                {vaultTask.daysTaken}d
              </div>
            )}
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Clock className="w-3 h-3" />
              {archivedDisplay}
            </div>
          </div>
        </div>
      </GlowCard>
    </motion.div>
  )
}
