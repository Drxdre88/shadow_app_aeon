'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, Tag, Clock, Timer, RotateCcw, X, Check, Calendar } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils/cn'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import type { TaskVault } from '@/lib/db/schema'

interface TrophyDetailModalProps {
  vaultTask: TaskVault | null
  onClose: () => void
  onRestore?: (vaultId: string) => void
}

const priorityStyles: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  low: { bg: 'bg-slate-500/20', border: 'border-slate-500/30', text: 'text-slate-400', glow: 'rgba(100,116,139,0.4)' },
  medium: { bg: 'bg-blue-500/20', border: 'border-blue-500/30', text: 'text-blue-400', glow: 'rgba(59,130,246,0.4)' },
  high: { bg: 'bg-orange-500/20', border: 'border-orange-500/30', text: 'text-orange-400', glow: 'rgba(249,115,22,0.4)' },
  urgent: { bg: 'bg-red-500/20', border: 'border-red-500/30', text: 'text-red-400', glow: 'rgba(239,68,68,0.4)' },
}

export function TrophyDetailModal({ vaultTask, onClose, onRestore }: TrophyDetailModalProps) {
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  if (!vaultTask) return null

  const labelSnapshot = (vaultTask.labelSnapshot ?? []) as Array<{ name: string; color: string }>
  const checklistSnapshot = (vaultTask.checklistSnapshot ?? {}) as { total?: number; checked?: number }
  const pStyle = priorityStyles[vaultTask.priority] ?? priorityStyles.medium
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
            'shadow-[0_0_40px_rgba(16,185,129,0.2)]'
          )}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div
                className={cn('w-8 h-8 rounded-lg border flex items-center justify-center', pStyle.bg, pStyle.border)}
                style={{ boxShadow: `0 0 ${12 * mult}px ${pStyle.glow}` }}
              >
                <Trophy className={cn('w-4 h-4', pStyle.text)} />
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

          <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {vaultTask.description && (
              <p className="text-sm text-slate-300 leading-relaxed">{vaultTask.description}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <span
                className={cn('px-2.5 py-1 rounded-md text-xs font-medium border capitalize', pStyle.bg, pStyle.border, pStyle.text)}
                style={{ boxShadow: `0 0 8px ${pStyle.glow}` }}
              >
                {vaultTask.priority}
              </span>
              {vaultTask.size !== null && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium border bg-cyan-500/15 border-cyan-500/25 text-cyan-400">
                  {vaultTask.size}d size
                </span>
              )}
              {vaultTask.daysTaken !== null && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border bg-purple-500/15 border-purple-500/25 text-purple-400">
                  <Timer className="w-3 h-3" />
                  {vaultTask.daysTaken}d taken
                </span>
              )}
            </div>

            {labelSnapshot.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-slate-500 font-medium">Labels</span>
                <div className="flex flex-wrap gap-1.5">
                  {labelSnapshot.map((label, i) => {
                    const presetColors = colorConfig[label.color as AccentColor]
                    const isCustom = !presetColors
                    const hex = label.color.startsWith('#') ? label.color : `#${label.color}`
                    return (
                      <span
                        key={i}
                        className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 border',
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
              </div>
            )}

            {checklistSnapshot.total && checklistSnapshot.total > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-slate-500 font-medium">Checklist</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${((checklistSnapshot.checked ?? 0) / checklistSnapshot.total) * 100}%`,
                        background: 'linear-gradient(90deg, #10b981, #06d6a0)',
                        boxShadow: '0 0 6px rgba(16,185,129,0.4)',
                      }}
                    />
                  </div>
                  <span className="text-xs font-mono tabular-nums">
                    <span className="text-emerald-400">{checklistSnapshot.checked ?? 0}</span>
                    <span className="text-slate-600">/</span>
                    <span className="text-slate-400">{checklistSnapshot.total}</span>
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 pt-2 border-t border-white/5 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Completed {format(effectiveDate, 'MMM d, yyyy')}
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {formatDistanceToNow(effectiveDate, { addSuffix: true })}
              </div>
            </div>

            {vaultTask.originalCreatedAt && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Calendar className="w-3.5 h-3.5" />
                Created {format(new Date(vaultTask.originalCreatedAt), 'MMM d, yyyy')}
              </div>
            )}
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
