import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  subWeeks,
  subMonths,
  addDays,
  addWeeks,
  format,
} from 'date-fns'

/**
 * Pure aggregation helpers for the Trophy Vault surface.
 * Everything takes an injectable `now` for deterministic tests.
 */

export interface TrophyDatum {
  completedAt?: Date | string | null
  archivedAt: Date | string
  priority?: string | null
  daysTaken?: number | null
  size?: number | null
  labelSnapshot?: unknown
  columnName?: string | null
}

/** Effective celebration date: completion wins, archive date is the fallback. */
export function trophyDate(t: TrophyDatum): Date {
  return t.completedAt ? new Date(t.completedAt) : new Date(t.archivedAt)
}

// ---------------------------------------------------------------------------
// Completion-over-time buckets (zero-filled, contiguous, oldest -> newest)
// ---------------------------------------------------------------------------

export type ChartGranularity = 'week' | 'month'

export interface PeriodBucket {
  key: string
  label: string
  count: number
}

export function bucketByPeriod(
  tasks: TrophyDatum[],
  granularity: ChartGranularity,
  periods: number,
  now: Date = new Date()
): PeriodBucket[] {
  const periodStart = (d: Date) =>
    granularity === 'week' ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d)

  const buckets: PeriodBucket[] = []
  const index = new Map<string, number>()

  for (let i = periods - 1; i >= 0; i--) {
    const start = periodStart(granularity === 'week' ? subWeeks(now, i) : subMonths(now, i))
    const key = start.toISOString()
    index.set(key, buckets.length)
    buckets.push({
      key,
      label: granularity === 'week' ? format(start, 'd MMM') : format(start, 'MMM'),
      count: 0,
    })
  }

  for (const t of tasks) {
    const key = periodStart(trophyDate(t)).toISOString()
    const i = index.get(key)
    if (i !== undefined) buckets[i].count++
  }

  return buckets
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export type StreakGranularity = 'day' | 'week'

export interface StreakStats {
  /** Consecutive periods with >=1 trophy, ending in the current or previous period. */
  current: number
  /** Longest run of consecutive periods ever. */
  best: number
}

export function computeStreak(
  tasks: TrophyDatum[],
  granularity: StreakGranularity,
  now: Date = new Date()
): StreakStats {
  const periodStart = (d: Date) =>
    granularity === 'day' ? startOfDay(d) : startOfWeek(d, { weekStartsOn: 1 })
  const stepBack = (d: Date) =>
    periodStart(granularity === 'day' ? addDays(d, -1) : addWeeks(d, -1))
  const stepForward = (d: Date) =>
    periodStart(granularity === 'day' ? addDays(d, 1) : addWeeks(d, 1))

  const hits = new Set<number>()
  for (const t of tasks) hits.add(periodStart(trophyDate(t)).getTime())
  if (hits.size === 0) return { current: 0, best: 0 }

  const sorted = [...hits].sort((a, b) => a - b)

  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    if (stepForward(new Date(sorted[i - 1])).getTime() === sorted[i]) {
      run++
      if (run > best) best = run
    } else {
      run = 1
    }
  }

  // Current streak: anchored at the current period, or the previous one
  // (a streak isn't broken until a full period passes without a trophy).
  const cur = periodStart(now).getTime()
  const prev = stepBack(new Date(cur)).getTime()
  let anchor: number | null = hits.has(cur) ? cur : hits.has(prev) ? prev : null

  let current = 0
  while (anchor !== null && hits.has(anchor)) {
    current++
    anchor = stepBack(new Date(anchor)).getTime()
  }

  return { current, best: Math.max(best, current) }
}

// ---------------------------------------------------------------------------
// This month vs last month
// ---------------------------------------------------------------------------

export interface MonthComparison {
  thisMonth: number
  lastMonth: number
  /** Percent change vs last month; null when last month had none. */
  deltaPct: number | null
}

export function monthComparison(tasks: TrophyDatum[], now: Date = new Date()): MonthComparison {
  const thisStart = startOfMonth(now).getTime()
  const lastStart = startOfMonth(subMonths(now, 1)).getTime()

  let thisMonth = 0
  let lastMonth = 0
  for (const t of tasks) {
    const s = startOfMonth(trophyDate(t)).getTime()
    if (s === thisStart) thisMonth++
    else if (s === lastStart) lastMonth++
  }

  const deltaPct = lastMonth === 0 ? null : Math.round(((thisMonth - lastMonth) / lastMonth) * 100)
  return { thisMonth, lastMonth, deltaPct }
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export interface BreakdownRow {
  key: string
  label: string
  count: number
  /** Share of all trophies (0..1). Label rows can sum past 1 (multi-label). */
  share: number
  /** Optional identity color (label snapshots carry their own). */
  color?: string
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const
const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function breakdownByPriority(tasks: TrophyDatum[]): BreakdownRow[] {
  const counts = new Map<string, number>()
  for (const t of tasks) {
    const p = t.priority && PRIORITY_LABELS[t.priority] ? t.priority : 'medium'
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  const total = tasks.length || 1
  return PRIORITY_ORDER.filter((p) => (counts.get(p) ?? 0) > 0).map((p) => ({
    key: p,
    label: PRIORITY_LABELS[p],
    count: counts.get(p)!,
    share: counts.get(p)! / total,
  }))
}

export function breakdownByLabel(tasks: TrophyDatum[], top = 6): BreakdownRow[] {
  const map = new Map<string, { label: string; color?: string; count: number }>()
  let unlabeled = 0

  for (const t of tasks) {
    const labels = (t.labelSnapshot ?? []) as Array<{ name?: string; color?: string }>
    const named = labels.filter((l) => typeof l?.name === 'string' && l.name.length > 0)
    if (named.length === 0) {
      unlabeled++
      continue
    }
    for (const l of named) {
      const key = l.name!.toLowerCase()
      const entry = map.get(key)
      if (entry) entry.count++
      else map.set(key, { label: l.name!, color: l.color, count: 1 })
    }
  }

  const total = tasks.length || 1
  const rows: BreakdownRow[] = [...map.entries()]
    .map(([key, { label, color, count }]) => ({ key, label, count, share: count / total, color }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, top)

  if (unlabeled > 0) {
    rows.push({ key: 'unlabeled', label: 'Unlabeled', count: unlabeled, share: unlabeled / total })
  }
  return rows
}

export function breakdownByColumn(tasks: TrophyDatum[], top = 6): BreakdownRow[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const t of tasks) {
    const label = t.columnName && t.columnName.trim().length > 0 ? t.columnName : 'Board'
    const key = label.toLowerCase()
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { label, count: 1 })
  }
  const total = tasks.length || 1
  return [...counts.entries()]
    .map(([key, { label, count }]) => ({ key, label, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, top)
}

// ---------------------------------------------------------------------------
// Effort banked
// ---------------------------------------------------------------------------

/** Sum of size estimates across trophies (days of effort banked). */
export function sumSize(tasks: TrophyDatum[]): number {
  let total = 0
  for (const t of tasks) {
    if (typeof t.size === 'number' && Number.isFinite(t.size)) total += t.size
  }
  return Math.round(total * 10) / 10
}
