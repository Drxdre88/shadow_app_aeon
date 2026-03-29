'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Tag, CheckSquare, Calendar, Link2, Clock } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useBoardStore, useLabels } from '@/lib/store/boardStore'
import { colorConfig, AccentColor, hexToRgba } from '@/lib/utils/colors'
import { formatDistanceToNow } from 'date-fns'

interface CardPeekPreviewProps {
  taskId: string
  triggerRef: React.RefObject<HTMLElement | null>
}

const HOVER_DELAY = 600
const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#64748b',
}

export function CardPeekPreview({ taskId, triggerRef }: CardPeekPreviewProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const enabled = useThemeStore((s) => s.cardPreviewOnHover)
  const colors = useThemeStore((s) => s.colors)
  const glowIntensity = useThemeStore((s) => s.glowIntensity)
  const mult = glowIntensity / 75
  const labels = useLabels()
  const task = useBoardStore((s) => s.tasks.find((t) => t.id === taskId))
  const clSummary = useBoardStore((s) => s.checklistSummaries[taskId])
  const dependencies = useBoardStore((s) => s.dependencies)

  const taskLabels = labels.filter((l) => task?.labels.includes(l.id))
  const blockers = dependencies.filter((d) => d.blockedTaskId === taskId)
  const blocking = dependencies.filter((d) => d.blockerTaskId === taskId)

  const handleEnter = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const spaceRight = window.innerWidth - rect.right
      const x = spaceRight > 320 ? rect.right + 8 : rect.left - 308
      const y = Math.min(rect.top, window.innerHeight - 350)
      setPos({ x: Math.max(8, x), y: Math.max(8, y) })
      setVisible(true)
    }, HOVER_DELAY)
  }, [triggerRef])

  const handleLeave = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setVisible(false)
  }, [])

  useEffect(() => {
    const el = triggerRef.current
    if (!el) return
    el.addEventListener('mouseenter', handleEnter)
    el.addEventListener('mouseleave', handleLeave)
    return () => {
      el.removeEventListener('mouseenter', handleEnter)
      el.removeEventListener('mouseleave', handleLeave)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [triggerRef, handleEnter, handleLeave])

  if (!enabled || !task) return null

  const checkTotal = clSummary?.total ?? 0
  const checkDone = clSummary?.checked ?? 0
  const checkPct = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0
  const priColor = PRIORITY_COLORS[task.priority] ?? '#64748b'
  const updatedAgo = task.updatedAt ? formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true }) : null

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={previewRef}
          initial={{ opacity: 0, x: -8, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: -8, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="fixed z-[150] w-[300px] rounded-xl border overflow-hidden pointer-events-none"
          style={{
            left: pos.x,
            top: pos.y,
            background: `linear-gradient(to bottom, ${colors.background}f8, ${colors.background})`,
            borderColor: colors.border,
            boxShadow: [
              `0 0 ${30 * mult}px ${8 * mult}px ${colors.glowColor}`,
              '0 20px 40px -12px rgba(0,0,0,0.7)',
              'inset 0 1px 0 0 rgba(255,255,255,0.06)',
            ].join(', '),
          }}
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={handleLeave}
        >
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${priColor}, ${priColor}60)` }}
          />

          <div className="p-3.5 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white leading-snug mb-1">{task.name}</h3>
              {task.description && (
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{task.description}</p>
              )}
            </div>

            {checkTotal > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 flex items-center gap-1">
                    <CheckSquare className="w-3 h-3" />
                    Checklist
                  </span>
                  <span style={{ color: checkPct === 100 ? '#10b981' : colors.primary }}>
                    {checkDone}/{checkTotal} ({checkPct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${checkPct}%`,
                      background: checkPct === 100
                        ? 'linear-gradient(90deg, #10b981, #34d399)'
                        : `linear-gradient(90deg, ${colors.primary}, ${colors.glowColor})`,
                    }}
                  />
                </div>
              </div>
            )}

            {taskLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {taskLabels.map((label) => {
                  const preset = colorConfig[label.color as AccentColor]
                  const hex = label.color.startsWith('#') ? label.color : preset?.hex ?? '#a855f7'
                  return (
                    <span
                      key={label.id}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1"
                      style={{
                        backgroundColor: hexToRgba(hex, 0.15),
                        color: hex,
                        border: `1px solid ${hexToRgba(hex, 0.3)}`,
                      }}
                    >
                      <Tag className="w-2.5 h-2.5" />
                      {label.name}
                    </span>
                  )
                })}
              </div>
            )}

            {(blockers.length > 0 || blocking.length > 0) && (
              <div className="flex items-center gap-2">
                {blockers.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/25 flex items-center gap-1">
                    <Link2 className="w-2.5 h-2.5" />
                    {blockers.length} blocker{blockers.length > 1 ? 's' : ''}
                  </span>
                )}
                {blocking.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400/70 border border-amber-500/20 flex items-center gap-1">
                    <Link2 className="w-2.5 h-2.5" />
                    Blocks {blocking.length}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1 border-t border-white/5">
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ backgroundColor: `${priColor}20`, color: priColor }}
              >
                {task.priority}
              </span>
              {task.startDate && (
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5" />
                  {new Date(task.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              )}
              {updatedAgo && (
                <span className="text-[10px] text-slate-600 flex items-center gap-1 ml-auto">
                  <Clock className="w-2.5 h-2.5" />
                  {updatedAgo}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
