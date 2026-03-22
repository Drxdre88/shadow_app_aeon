import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  format,
  isToday,
  isThisWeek,
  isThisMonth,
} from 'date-fns'
import type { TaskVault } from '@/lib/db/schema'

export type ViewMode = 'timeline' | 'priority' | 'label'
export type DateGranularity = 'day' | 'week' | 'month'

export interface GroupedSection {
  key: string
  label: string
  tasks: TaskVault[]
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const
const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function getTimelineBucket(
  date: Date,
  granularity: DateGranularity
): { key: string; label: string } {
  if (granularity === 'day') {
    if (isToday(date)) return { key: 'today', label: 'Today' }
    const start = startOfDay(date)
    return { key: start.toISOString(), label: format(date, 'EEEE, d MMMM yyyy') }
  }

  if (granularity === 'week') {
    if (isThisWeek(date, { weekStartsOn: 1 }))
      return { key: 'this-week', label: 'This Week' }
    const start = startOfWeek(date, { weekStartsOn: 1 })
    return { key: start.toISOString(), label: `Week of ${format(start, 'd MMM yyyy')}` }
  }

  if (isToday(date)) return { key: 'today', label: 'Today' }
  if (isThisWeek(date, { weekStartsOn: 1 }))
    return { key: 'this-week', label: 'This Week' }
  if (isThisMonth(date))
    return { key: 'this-month', label: 'Earlier this Month' }
  const start = startOfMonth(date)
  return { key: start.toISOString(), label: format(date, 'MMMM yyyy') }
}

export function groupByTimeline(
  tasks: TaskVault[],
  granularity: DateGranularity
): GroupedSection[] {
  const map = new Map<string, { label: string; tasks: TaskVault[] }>()

  for (const task of tasks) {
    const { key, label } = getTimelineBucket(new Date(task.archivedAt), granularity)
    if (!map.has(key)) map.set(key, { label, tasks: [] })
    map.get(key)!.tasks.push(task)
  }

  return Array.from(map.entries()).map(([key, { label, tasks }]) => ({ key, label, tasks }))
}

export function groupByPriority(tasks: TaskVault[]): GroupedSection[] {
  const map = new Map<string, TaskVault[]>()
  for (const p of PRIORITY_ORDER) map.set(p, [])

  for (const task of tasks) {
    const p = task.priority ?? 'medium'
    map.get(p)!.push(task)
  }

  return PRIORITY_ORDER.map((p) => ({
    key: p,
    label: PRIORITY_LABELS[p],
    tasks: map.get(p) ?? [],
  }))
}

export function groupByLabel(tasks: TaskVault[]): GroupedSection[] {
  const map = new Map<string, { label: string; tasks: TaskVault[] }>()
  const unlabeled: TaskVault[] = []

  for (const task of tasks) {
    const labels = (task.labelSnapshot ?? []) as Array<{ name: string; color: string }>
    if (labels.length === 0) {
      unlabeled.push(task)
      continue
    }
    for (const lbl of labels) {
      const key = lbl.name.toLowerCase()
      if (!map.has(key)) map.set(key, { label: lbl.name, tasks: [] })
      map.get(key)!.tasks.push(task)
    }
  }

  const sections: GroupedSection[] = Array.from(map.entries()).map(([key, { label, tasks }]) => ({ key, label, tasks }))

  sections.sort((a, b) => b.tasks.length - a.tasks.length)

  if (unlabeled.length > 0) {
    sections.push({ key: 'unlabeled', label: 'Unlabeled', tasks: unlabeled })
  }

  return sections
}
