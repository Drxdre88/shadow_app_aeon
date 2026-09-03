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
import { NO_PRIORITY_KEY, NO_PRIORITY_LABEL } from './trophy-stats'

export type ViewMode = 'timeline' | 'priority' | 'label'
export type DateGranularity = 'day' | 'week' | 'month'

export interface GroupedSection {
  key: string
  label: string
  tasks: TaskVault[]
}

/** Factory levels, highest first — only a fallback when no configured order is supplied. */
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const

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
    const effectiveDate = task.completedAt ? new Date(task.completedAt) : new Date(task.archivedAt)
    const { key, label } = getTimelineBucket(effectiveDate, granularity)
    if (!map.has(key)) map.set(key, { label, tasks: [] })
    map.get(key)!.tasks.push(task)
  }

  return Array.from(map.entries()).map(([key, { label, tasks }]) => ({ key, label, tasks }))
}

/**
 * Groups by RAW priority id. `order` is the user's configured id list, highest
 * level first; those buckets always render (empty included), and any id outside
 * it — a custom level, or a level since removed — gets its own bucket appended
 * rather than being force-fitted into a factory one. (The previous version
 * indexed a map pre-seeded with only the four factory ids and dereferenced the
 * miss, so a single custom-priority trophy threw.) Names and colors are the
 * caller's job — resolve through `@/lib/utils/priorities`.
 */
export function groupByPriority(
  tasks: TaskVault[],
  order: readonly string[] = PRIORITY_ORDER
): GroupedSection[] {
  const map = new Map<string, TaskVault[]>()
  for (const p of order) map.set(p, [])

  for (const task of tasks) {
    const raw = typeof task.priority === 'string' ? task.priority.trim() : ''
    const key = raw.length > 0 ? raw : NO_PRIORITY_KEY
    const bucket = map.get(key)
    if (bucket) bucket.push(task)
    else map.set(key, [task])
  }

  return [...map.entries()].map(([key, tasks]) => ({
    key,
    label: key === NO_PRIORITY_KEY ? NO_PRIORITY_LABEL : key,
    tasks,
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
