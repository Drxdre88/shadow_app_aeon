'use client'

import { memo, useMemo, useState, useCallback } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, Search, Trophy } from 'lucide-react'
import { format } from 'date-fns'
import { useThemeStore } from '@/stores/themeStore'
import { colorConfig, type AccentColor } from '@/lib/utils/colors'
import { resolvePriority } from '@/lib/utils/priorities'
import { cn } from '@/lib/utils/cn'
import { trophyDate } from './trophy-stats'
import { goldText, hexAlpha } from './trophy-theme'
import type { CustomPriority } from '@aeon/shared'
import type { TaskVault } from '@/lib/db/schema'

type SortKey = 'name' | 'column' | 'priority' | 'size' | 'days' | 'completed'
type SortDir = 'asc' | 'desc'

interface TrophyTableProps {
  tasks: TaskVault[]
  onRestore: (vaultId: string) => void
  onSelect: (vaultTask: TaskVault) => void
}

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'name', label: 'Trophy', className: 'text-left' },
  { key: 'column', label: 'From', className: 'text-left' },
  { key: 'priority', label: 'Priority', className: 'text-left' },
  { key: 'size', label: 'Size', className: 'text-right' },
  { key: 'days', label: 'Days', className: 'text-right' },
  { key: 'completed', label: 'Completed', className: 'text-right' },
]

interface RowProps {
  task: TaskVault
  isDark: boolean
  textColor: string
  mutedColor: string
  dimColor: string
  borderColor: string
  gold: string
  priorities: CustomPriority[]
  onRestore: (vaultId: string) => void
  onSelect: (vaultTask: TaskVault) => void
}

const TrophyTableRow = memo(function TrophyTableRow({
  task,
  isDark,
  textColor,
  mutedColor,
  dimColor,
  borderColor,
  gold,
  priorities,
  onRestore,
  onSelect,
}: RowProps) {
  const labels = (task.labelSnapshot ?? []) as Array<{ name: string; color: string }>
  const date = trophyDate(task)
  const resolvedPriority = resolvePriority(priorities, task.priority)

  return (
    <tr
      onClick={() => onSelect(task)}
      className="cursor-pointer transition-colors duration-150 hover:bg-[var(--trophy-row-hover)] group"
      style={{ borderBottom: `1px solid ${borderColor}` }}
    >
      <td className="px-3 py-2.5 max-w-[280px]">
        <div className="flex items-center gap-2 min-w-0">
          <Trophy className="w-3.5 h-3.5 flex-shrink-0" style={{ color: gold }} />
          <span className="text-sm font-medium truncate" style={{ color: textColor }}>
            {task.name}
          </span>
        </div>
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1 pl-[22px]">
            {labels.slice(0, 4).map((label, i) => {
              const hex = label.color?.startsWith('#')
                ? label.color
                : colorConfig[label.color as AccentColor]?.hex ?? gold
              return (
                <span
                  key={i}
                  className="px-1.5 py-px rounded text-[10px] font-medium truncate max-w-[110px]"
                  style={{
                    color: hex,
                    backgroundColor: hexAlpha(hex, isDark ? 0.14 : 0.1),
                    border: `1px solid ${hexAlpha(hex, 0.3)}`,
                  }}
                >
                  {label.name}
                </span>
              )
            })}
            {labels.length > 4 && (
              <span className="text-[10px]" style={{ color: dimColor }}>+{labels.length - 4}</span>
            )}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: mutedColor }}>
        {task.columnName ?? '—'}
      </td>
      <td className="px-3 py-2.5">
        <span
          className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize whitespace-nowrap"
          style={{
            color: resolvedPriority.color,
            backgroundColor: hexAlpha(resolvedPriority.color, isDark ? 0.14 : 0.1),
            border: `1px solid ${hexAlpha(resolvedPriority.color, 0.3)}`,
          }}
        >
          {resolvedPriority.name}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-right tabular-nums whitespace-nowrap" style={{ color: mutedColor }}>
        {task.size !== null ? `${task.size}d` : '—'}
      </td>
      <td className="px-3 py-2.5 text-xs text-right tabular-nums whitespace-nowrap" style={{ color: mutedColor }}>
        {task.daysTaken !== null ? task.daysTaken : '—'}
      </td>
      <td className="px-3 py-2.5 text-xs text-right tabular-nums whitespace-nowrap" style={{ color: mutedColor }}>
        {format(date, 'd MMM yyyy')}
      </td>
      <td className="px-2 py-2.5 text-right w-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRestore(task.id)
          }}
          title="Restore to board"
          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150"
          style={{ color: gold, background: hexAlpha(gold.startsWith('#') ? gold : '#f59e0b', 0.1) }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  )
})

export const TrophyTable = memo(function TrophyTable({ tasks, onRestore, onSelect }: TrophyTableProps) {
  const { colors, priorities } = useThemeStore()
  const gold = goldText(colors.isDark)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('completed')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir(key === 'name' || key === 'column' ? 'asc' : 'desc')
      return key
    })
  }, [])

  // Rank follows the user's configured priority order (low -> urgent)
  const priorityRank = useMemo(() => {
    const m = new Map<string, number>()
    priorities.forEach((p, i) => m.set(p.id, i))
    return m
  }, [priorities])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let result = tasks
    if (q) {
      result = tasks.filter((t) => {
        if (t.name.toLowerCase().includes(q)) return true
        const labels = (t.labelSnapshot ?? []) as Array<{ name?: string }>
        return labels.some((l) => l.name?.toLowerCase().includes(q))
      })
    }
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...result]
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir
        case 'column':
          return (a.columnName ?? '').localeCompare(b.columnName ?? '') * dir
        case 'priority':
          return ((priorityRank.get(a.priority) ?? -1) - (priorityRank.get(b.priority) ?? -1)) * dir
        case 'size':
          return ((a.size ?? -1) - (b.size ?? -1)) * dir
        case 'days':
          return ((a.daysTaken ?? -1) - (b.daysTaken ?? -1)) * dir
        default:
          return (trophyDate(a).getTime() - trophyDate(b).getTime()) * dir
      }
    })
    return sorted
  }, [tasks, query, sortKey, sortDir, priorityRank])

  return (
    <div
      className="rounded-2xl backdrop-blur-xl overflow-hidden flex flex-col"
      style={
        {
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          '--trophy-row-hover': colors.surfaceHover,
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
        <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: colors.textDim }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trophies or labels…"
          className="flex-1 bg-transparent text-xs outline-none placeholder:opacity-60"
          style={{ color: colors.text }}
        />
        <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: colors.textDim }}>
          {rows.length} {rows.length === 1 ? 'trophy' : 'trophies'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key
                const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <th key={col.key} className={cn('px-3 py-2', col.className)}>
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold transition-colors duration-150',
                        col.className?.includes('text-right') && 'flex-row-reverse'
                      )}
                      style={{ color: active ? gold : colors.textDim }}
                    >
                      {col.label}
                      <Icon className={cn('w-3 h-3', !active && 'opacity-40')} />
                    </button>
                  </th>
                )
              })}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <TrophyTableRow
                key={task.id}
                task={task}
                isDark={colors.isDark}
                textColor={colors.text}
                mutedColor={colors.textMuted}
                dimColor={colors.textDim}
                borderColor={colors.border}
                gold={gold}
                priorities={priorities}
                onRestore={onRestore}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="py-10 text-center text-xs" style={{ color: colors.textDim }}>
            No trophies match this search
          </div>
        )}
      </div>
    </div>
  )
})
