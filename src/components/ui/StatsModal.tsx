'use client'

import { useState, useCallback, useEffect } from 'react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, BarChart3, FolderOpen, CheckSquare, ListChecks, Sparkles, Calendar, Activity, Clock } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

interface Stats {
  projects: number
  tasks: number
  checklistItems: number
  canvasNodes: number
  ganttTasks: number
  activityEvents: number
  memberSince: string | null
}

const FREE_TIER_MAX = 0.5 * 1024

const LIMITS = { tasks: 500, canvasNodes: 200, ganttTasks: 200 }

function estimateKB(stats: Stats): number {
  return (
    stats.tasks * 1 +
    stats.checklistItems * 0.3 +
    stats.canvasNodes * 0.5 +
    stats.ganttTasks * 0.5 +
    stats.activityEvents * 0.2
  )
}

function LimitBar({ label, current, limit, color }: { label: string; current: number; limit: number; color: string }) {
  const pct = Math.min((current / limit) * 100, 100)
  const isWarning = pct >= 80

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className={isWarning ? 'text-orange-400 font-medium' : 'text-slate-500'}>
          {current} / {limit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: isWarning
              ? 'linear-gradient(90deg, #f97316, #ef4444)'
              : `linear-gradient(90deg, ${color}, ${color}88)`,
          }}
        />
      </div>
    </div>
  )
}

interface StatCardProps {
  icon: typeof FolderOpen
  label: string
  value: number | string
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
      </div>
    </div>
  )
}

interface StatsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function StatsModal({ isOpen, onClose }: StatsModalProps) {
  const mounted = useHasMounted()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  useEffect(() => { // eslint-disable-line react-hooks/set-state-in-effect
    if (!isOpen) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    fetch('/api/stats', { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false) })
      .catch((e) => { if (e.name !== 'AbortError') { setError(true); setLoading(false) } })
    return () => controller.abort()
  }, [isOpen])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleKeyDown])

  if (!mounted || !isOpen) return null

  const usedKB = stats ? estimateKB(stats) : 0
  const usagePercent = Math.min((usedKB / FREE_TIER_MAX) * 100, 100)

  const memberSinceFormatted = stats?.memberSince
    ? new Date(stats.memberSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 28, mass: 0.8 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-lg mx-2 sm:mx-0',
          'rounded-2xl border border-white/[0.12]',
          'flex flex-col relative overflow-hidden'
        )}
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor}`,
            '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
          ].join(', '),
        }}
      >
        <div
          className="absolute top-0 left-6 right-6 h-[1.5px]"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--primary), transparent)',
            boxShadow: `0 0 ${15 * mult}px ${3 * mult}px var(--glow-color)`,
          }}
        />

        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white">Usage Stats</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close stats"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 text-sm">
              Loading...
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center justify-center py-10 text-red-400 text-sm">
              Failed to load stats. Try again later.
            </div>
          )}

          {!loading && !error && stats && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={FolderOpen} label="Projects" value={stats.projects} />
                <StatCard icon={CheckSquare} label="Tasks" value={stats.tasks} />
                <StatCard icon={ListChecks} label="Checklist Items" value={stats.checklistItems} />
                <StatCard icon={Sparkles} label="Canvas Nodes" value={stats.canvasNodes} />
                <StatCard icon={Calendar} label="Gantt Tasks" value={stats.ganttTasks} />
                <StatCard icon={Activity} label="Activity Events" value={stats.activityEvents} />
              </div>

              <div className="flex items-center gap-3 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Member since</p>
                  <p className="text-sm font-medium text-white">{memberSinceFormatted}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Estimated usage</span>
                  <span>{usedKB < 1024 ? `${usedKB.toFixed(0)} KB` : `${(usedKB / 1024).toFixed(2)} MB`} / 0.5 GB</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${usagePercent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{
                      background: usagePercent > 80
                        ? 'linear-gradient(90deg, #f97316, #ef4444)'
                        : `linear-gradient(90deg, ${colors.primary}, ${colors.glowColor})`,
                    }}
                  />
                </div>
                <p className="text-xs text-slate-600">Free tier estimate — based on ~1 KB per task</p>
              </div>

              <div className="space-y-2.5 pt-1">
                <p className="text-xs text-slate-500 font-medium">Entity Limits</p>
                <LimitBar label="Tasks" current={stats.tasks} limit={LIMITS.tasks} color={colors.primary} />
                <LimitBar label="Canvas Nodes" current={stats.canvasNodes} limit={LIMITS.canvasNodes} color={colors.primary} />
                <LimitBar label="Gantt Tasks" current={stats.ganttTasks} limit={LIMITS.ganttTasks} color={colors.primary} />
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

export function StatsButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { glowIntensity, colors } = useThemeStore()

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        style={{
          boxShadow: glowIntensity > 50 ? `0 0 ${10 * (glowIntensity / 100)}px ${colors.glowColor}` : 'none',
        }}
      >
        <BarChart3 className="w-5 h-5 text-slate-400" />
      </motion.button>

      <StatsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
