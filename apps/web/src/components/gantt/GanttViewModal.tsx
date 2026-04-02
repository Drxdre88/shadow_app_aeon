'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Check, Columns3, Tag, AlertTriangle, GitBranch, ArrowDownAZ, ListOrdered } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useColumns, useTasks, useLabels, useDependencies } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, generateId } from '@/lib/utils/colors'

const GROUP_BY_OPTIONS = [
  { value: 'column', label: 'By Column', icon: Columns3 },
  { value: 'label', label: 'By Label', icon: Tag },
  { value: 'priority', label: 'By Priority', icon: AlertTriangle },
  { value: 'dependency', label: 'By Dependency', icon: GitBranch },
] as const

const TASK_ORDER_OPTIONS = [
  { value: 'column', label: 'By Column Position', icon: ListOrdered },
  { value: 'alphabetical', label: 'Alphabetical', icon: ArrowDownAZ },
] as const

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: 'red',
  High: 'orange',
  Medium: 'blue',
  Low: 'none',
}

interface SectionInfo {
  name: string
  color: string
  count: number
}

interface GanttViewModalProps {
  projectId: string
  mode: 'create' | 'edit'
  existingView?: {
    id: string; name: string; groupBy: string; excludedSections?: string[]
    taskOrder?: string; allowWeekends?: boolean; allowMultipleRows?: boolean; allowOverlap?: boolean
  }
  onConfirm: (view: {
    id: string; projectId: string; name: string; groupBy: string; excludedSections: string[]
    taskOrder: string; allowWeekends: boolean; allowMultipleRows: boolean; allowOverlap: boolean
  }) => void
  onClose: () => void
}

function GlowCheckbox({ checked }: { checked: boolean }) {
  return (
    <div
      className={cn(
        'flex-shrink-0 w-5 h-5 rounded border-2 transition-all duration-300',
        'flex items-center justify-center',
        checked && 'bg-emerald-500 border-emerald-400',
        !checked && 'border-white/30'
      )}
      style={{
        boxShadow: checked
          ? '0 0 12px rgba(16,185,129,0.6), 0 0 24px rgba(16,185,129,0.3)'
          : undefined,
      }}
    >
      {checked && <Check className="w-3 h-3 text-white drop-shadow-[0_0_4px_rgba(16,185,129,0.8)]" />}
    </div>
  )
}

function ColorDot({ color }: { color: string }) {
  const cfg = colorConfig[color as keyof typeof colorConfig]
  const hex = cfg?.hex ?? (color.startsWith('#') ? color : '#94a3b8')

  return (
    <span
      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: hex, boxShadow: `0 0 6px ${hex}80` }}
    />
  )
}

export function GanttViewModal({ projectId, mode, existingView, onConfirm, onClose }: GanttViewModalProps) {
  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState(existingView?.name ?? '')
  const [groupBy, setGroupBy] = useState(existingView?.groupBy ?? 'column')
  const [excluded, setExcluded] = useState<Set<string>>(new Set(existingView?.excludedSections ?? []))
  const [taskOrder, setTaskOrder] = useState(existingView?.taskOrder ?? 'column')
  const [allowWeekends, setAllowWeekends] = useState(existingView?.allowWeekends ?? false)
  const [allowMultipleRows, setAllowMultipleRows] = useState(existingView?.allowMultipleRows ?? false)
  const [allowOverlap, setAllowOverlap] = useState(existingView?.allowOverlap ?? false)

  const columns = useColumns()
  const tasks = useTasks()
  const labels = useLabels()
  const dependencies = useDependencies()
  const { colors, glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true) }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const sections: SectionInfo[] = useMemo(() => {
    switch (groupBy) {
      case 'column':
        return columns
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((c) => ({
            name: c.name,
            color: c.color,
            count: tasks.filter((t) => t.columnId === c.id).length,
          }))

      case 'label': {
        const labelSections = labels.map((l) => ({
          name: l.name,
          color: l.color,
          count: tasks.filter((t) => t.labels.includes(l.id)).length,
        }))
        labelSections.push({
          name: 'Untagged',
          color: 'none',
          count: tasks.filter((t) => t.labels.length === 0).length,
        })
        return labelSections
      }

      case 'priority':
        return ['Urgent', 'High', 'Medium', 'Low'].map((p) => ({
          name: p,
          color: PRIORITY_COLORS[p],
          count: tasks.filter((t) => t.priority === p.toLowerCase()).length,
        }))

      case 'dependency': {
        const hasBlocker = new Set<string>()
        const graph = new Map<string, string[]>()
        for (const dep of dependencies) {
          hasBlocker.add(dep.blockedTaskId)
          const children = graph.get(dep.blockerTaskId) || []
          children.push(dep.blockedTaskId)
          graph.set(dep.blockerTaskId, children)
        }
        const rootTasks = tasks.filter((t) => !hasBlocker.has(t.id))
        const visited = new Set<string>()
        const chains: { name: string; count: number }[] = []

        for (const root of rootTasks) {
          if (visited.has(root.id)) continue
          const chain: string[] = []
          const queue = [root.id]
          while (queue.length > 0) {
            const current = queue.shift()!
            if (visited.has(current)) continue
            visited.add(current)
            chain.push(current)
            const children = graph.get(current) || []
            queue.push(...children)
          }
          if (chain.length > 1) {
            chains.push({ name: root.name, count: chain.length })
          }
        }

        const chainedIds = new Set<string>()
        for (const root of rootTasks) {
          if (!graph.has(root.id) && !hasBlocker.has(root.id)) continue
          const queue = [root.id]
          while (queue.length > 0) {
            const current = queue.shift()!
            if (chainedIds.has(current)) continue
            chainedIds.add(current)
            const children = graph.get(current) || []
            queue.push(...children)
          }
        }
        const independentCount = tasks.filter((t) => !chainedIds.has(t.id)).length

        if (independentCount > 0 || chains.length === 0) {
          chains.push({ name: 'Independent', count: independentCount })
        }

        return chains.map((c) => ({ name: c.name, color: 'purple', count: c.count }))
      }

      default:
        return []
    }
  }, [groupBy, columns, tasks, labels, dependencies])

   
  useEffect(() => {
    if (mode === 'edit' && existingView?.excludedSections) {
      setExcluded(new Set(existingView.excludedSections))
      return
    }
    const autoExcluded = new Set<string>()
    sections.forEach((s) => {
      if (s.count === 0) autoExcluded.add(s.name)
    })
    setExcluded(autoExcluded)
  }, [sections, mode, existingView?.excludedSections])

  const toggleSection = (name: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const allChecked = sections.length > 0 && sections.every((s) => !excluded.has(s.name))
  const toggleAll = () => {
    if (allChecked) {
      setExcluded(new Set(sections.map((s) => s.name)))
    } else {
      setExcluded(new Set())
    }
  }

  const handleConfirm = () => {
    if (!name.trim()) return
    const id = existingView?.id ?? generateId()
    onConfirm({
      id,
      projectId,
      name: name.trim(),
      groupBy,
      excludedSections: Array.from(excluded),
      taskOrder,
      allowWeekends,
      allowMultipleRows,
      allowOverlap,
    })
  }

  if (!mounted) return null

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
          'w-full max-w-md max-h-[85vh] overflow-hidden',
          'rounded-2xl',
          'border border-white/[0.12]',
          'flex flex-col',
          'relative'
        )}
        style={{
          background: `linear-gradient(to bottom, ${colors.background}f5, ${colors.background})`,
          boxShadow: [
            `0 0 ${60 * mult}px ${15 * mult}px ${colors.glowColor}`,
            `0 25px 50px -12px rgba(0, 0, 0, 0.8)`,
            `inset 0 1px 0 0 rgba(255, 255, 255, 0.08)`,
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
          <h2 className="text-lg font-semibold text-white">
            {mode === 'create' ? 'New Gantt View' : 'Edit Gantt View'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="View name..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Group By</label>
            <div className="grid grid-cols-2 gap-2">
              {GROUP_BY_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const active = groupBy === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setGroupBy(opt.value)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                      active
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                    )}
                    style={active ? { boxShadow: '0 0 12px rgba(34,211,238,0.3)' } : undefined}
                  >
                    {active && <Check className="w-3.5 h-3.5" />}
                    {!active && <Icon className="w-3.5 h-3.5" />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Task Order</label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_ORDER_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const active = taskOrder === opt.value
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTaskOrder(opt.value)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                      active
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                    )}
                    style={active ? { boxShadow: '0 0 12px rgba(34,211,238,0.3)' } : undefined}
                  >
                    {active && <Check className="w-3.5 h-3.5" />}
                    {!active && <Icon className="w-3.5 h-3.5" />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Layout</label>
            <div className="space-y-1">
              <button
                onClick={() => setAllowMultipleRows(!allowMultipleRows)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left',
                  'bg-white/[0.04] hover:bg-white/[0.07]'
                )}
              >
                <GlowCheckbox checked={allowMultipleRows} />
                <span className="text-sm text-white">Allow Multiple Rows</span>
                <span className="text-xs text-slate-500 ml-auto">{allowMultipleRows ? 'Parallel lanes' : 'Single line'}</span>
              </button>
              <button
                onClick={() => setAllowOverlap(!allowOverlap)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left',
                  'bg-white/[0.04] hover:bg-white/[0.07]'
                )}
              >
                <GlowCheckbox checked={allowOverlap} />
                <span className="text-sm text-white">Allow Overlap</span>
                <span className="text-xs text-slate-500 ml-auto">{allowOverlap ? 'Free dates' : 'Sequential'}</span>
              </button>
              <button
                onClick={() => setAllowWeekends(!allowWeekends)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left',
                  'bg-white/[0.04] hover:bg-white/[0.07]'
                )}
              >
                <GlowCheckbox checked={allowWeekends} />
                <span className="text-sm text-white">Allow Weekends</span>
                <span className="text-xs text-slate-500 ml-auto">{allowWeekends ? 'Sat/Sun included' : 'Business days only'}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-400">Sections</label>
              <button
                onClick={toggleAll}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {allChecked ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="space-y-1">
              {sections.map((section) => {
                const isChecked = !excluded.has(section.name)
                return (
                  <button
                    key={section.name}
                    onClick={() => toggleSection(section.name)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left',
                      isChecked
                        ? 'bg-white/[0.04] hover:bg-white/[0.07]'
                        : 'bg-white/[0.01] opacity-50 hover:opacity-70'
                    )}
                  >
                    <GlowCheckbox checked={isChecked} />
                    <ColorDot color={section.color} />
                    <span className={cn(
                      'flex-1 text-sm',
                      isChecked ? 'text-white' : 'text-slate-500'
                    )}>
                      {section.name}
                    </span>
                    <span className="text-xs text-slate-500">({section.count})</span>
                  </button>
                )
              })}

              {sections.length === 0 && (
                <div className="text-center py-6 text-sm text-slate-500">
                  No sections available
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 text-slate-400 text-sm border border-white/10 hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!name.trim() || sections.every((s) => excluded.has(s.name))}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
              'hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed'
            )}
            style={{
              boxShadow: name.trim() ? '0 0 15px rgba(34,211,238,0.3)' : undefined,
            }}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
