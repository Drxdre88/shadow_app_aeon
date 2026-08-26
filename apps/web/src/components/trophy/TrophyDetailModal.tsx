'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Tag, Clock, Timer, RotateCcw, X, Check, Calendar } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { resolvePriority } from '@/lib/utils/priorities'
import type { TaskVault } from '@/lib/db/schema'

interface TrophyDetailModalProps {
  vaultTask: TaskVault | null
  onClose: () => void
  onRestore?: (vaultId: string) => void
}

export function TrophyDetailModal({ vaultTask, onClose, onRestore }: TrophyDetailModalProps) {
  const { glowIntensity, priorities } = useThemeStore()
  const mult = glowIntensity / 75

  if (!vaultTask) return null

  const labelSnapshot = (vaultTask.labelSnapshot ?? []) as Array<{ name: string; color: string }>
  const checklistSnapshot = (vaultTask.checklistSnapshot ?? {}) as { total?: number; checked?: number }
  const resolvedPriority = resolvePriority(priorities, vaultTask.priority)
  const pStyle = {
    boxStyle: {
      backgroundColor: hexToRgba(resolvedPriority.color, 0.2),
      borderColor: hexToRgba(resolvedPriority.color, 0.3),
    },
    color: resolvedPriority.color,
    glow: hexToRgba(resolvedPriority.color, 0.4),
  }
  const effectiveDate = vaultTask.completedAt ? new Date(vaultTask.completedAt) : new Date(vaultTask.archivedAt)

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-full max-w-md mx-3 rounded-xl overflow-hidden',
            'bg-gradient-to-b from-white/10 to-black/40',
            'backdrop-blur-xl border border-white/10',
            'shadow-[0_0_40px_rgba(245,158,11,0.18)]'
          )}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(140deg, rgba(251,191,36,0.28), rgba(180,83,9,0.22))',
                  border: '1px solid rgba(245,158,11,0.5)',
                  boxShadow: `0 0 ${12 * mult}px rgba(245,158,11,0.45)`,
                }}
              >
                <Trophy className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{vaultTask.name}</h3>
                {vaultTask.columnName && (
                  <span className="text-[10px] text-slate-500">from {vaultTask.columnName}</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">
            {vaultTask.description && (
              <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{vaultTask.description}</p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="px-2 py-0.5 rounded text-[10px] font-medium border capitalize"
                style={{ ...pStyle.boxStyle, color: pStyle.color }}
              >
                {resolvedPriority.name}
              </span>
              {vaultTask.daysTaken !== null && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)', color: 'var(--primary)' }}>
                  <Timer className="w-2.5 h-2.5" />
                  {vaultTask.daysTaken}d
                </span>
              )}
              {vaultTask.size !== null && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium border bg-white/5 border-white/10 text-slate-300">
                  {vaultTask.size}d est
                </span>
              )}
              {labelSnapshot.map((label, i) => {
                const presetColors = colorConfig[label.color as AccentColor]
                const isCustom = !presetColors
                const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
                return (
                  <span
                    key={i}
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 border',
                      !isCustom && presetColors?.bg,
                      !isCustom && presetColors?.border,
                      !isCustom && presetColors?.text,
                      isCustom && 'text-white'
                    )}
                    style={isCustom ? {
                      backgroundColor: hexToRgba(hex, 0.15),
                      borderColor: hexToRgba(hex, 0.3),
                      color: hex,
                    } : undefined}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {label.name}
                  </span>
                )
              })}
            </div>

            {checklistSnapshot.total && checklistSnapshot.total > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${((checklistSnapshot.checked ?? 0) / checklistSnapshot.total) * 100}%`,
                      background: 'linear-gradient(90deg, #10b981, #06d6a0)',
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono tabular-nums">
                  <span className="text-emerald-400">{checklistSnapshot.checked ?? 0}</span>
                  <span className="text-slate-600">/</span>
                  <span className="text-slate-400">{checklistSnapshot.total}</span>
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2 border-t border-white/5 text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-500" />
                {format(effectiveDate, 'dd MMM yyyy')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(effectiveDate, { addSuffix: true })}
              </span>
              {vaultTask.originalCreatedAt && (
                <span className="flex items-center gap-1 ml-auto">
                  <Calendar className="w-3 h-3" />
                  created {format(new Date(vaultTask.originalCreatedAt), 'dd MMM')}
                </span>
              )}
            </div>
          </div>

          {onRestore && (
            <div className="px-5 py-3 border-t border-white/10">
              <button
                onClick={() => { onRestore(vaultTask.id); onClose() }}
                className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-all"
              >
                <RotateCcw className="w-4 h-4" />
                Restore to Board
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
