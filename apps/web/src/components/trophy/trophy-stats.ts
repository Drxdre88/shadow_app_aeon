import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  subDays,
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

function warnMalformedDate(field: 'completedAt' | 'archivedAt', t: TrophyDatum) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[trophy] malformed ${field} on a vault row`, { completedAt: t.completedAt, archivedAt: t.archivedAt })
  }
}

/**
 * Effective celebration date: completion wins, archive date is the fallback —
 * also when the recorded completion does not parse (warned in dev).
 */
export function trophyDate(t: TrophyDatum): Date {
  if (t.completedAt) {
    const completed = new Date(t.completedAt)
    if (!Number.isNaN(completed.getTime())) return completed
    warnMalformedDate('completedAt', t)
  }
  return new Date(t.archivedAt)
}

/**
 * {@link trophyDate}, or null when neither timestamp parses. Every aggregator
 * skips such a row explicitly (warned in dev) instead of letting an Invalid
 * Date poison a bucket key or vanish without trace.
 */
export function validTrophyDate(t: TrophyDatum): Date | null {
  const d = trophyDate(t)
  if (Number.isNaN(d.getTime())) {
    warnMalformedDate('archivedAt', t)
    return null
  }
  return d
}

// ---------------------------------------------------------------------------
// Completion-over-time buckets (zero-filled, contiguous, oldest -> newest)
// ---------------------------------------------------------------------------

export type ChartGranularity = 'day' | 'week' | 'month'

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
    granularity === 'day'
      ? startOfDay(d)
      : granularity === 'week'
        ? startOfWeek(d, { weekStartsOn: 1 })
        : startOfMonth(d)
  const stepBack = (d: Date, i: number) =>
    granularity === 'day' ? subDays(d, i) : granularity === 'week' ? subWeeks(d, i) : subMonths(d, i)

  const buckets: PeriodBucket[] = []
  const index = new Map<string, number>()

  for (let i = periods - 1; i >= 0; i--) {
    const start = periodStart(stepBack(now, i))
    const key = start.toISOString()
    index.set(key, buckets.length)
    buckets.push({
      key,
      label: granularity === 'month' ? format(start, 'MMM') : format(start, 'd MMM'),
      count: 0,
    })
  }

  for (const t of tasks) {
    const d = validTrophyDate(t)
    if (!d) continue
    const key = periodStart(d).toISOString()
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
  for (const t of tasks) {
    const d = validTrophyDate(t)
    if (d) hits.add(periodStart(d).getTime())
  }
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
    const d = validTrophyDate(t)
    if (!d) continue
    const s = startOfMonth(d).getTime()
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

/** Bucket key for trophies archived with no priority recorded at all. */
export const NO_PRIORITY_KEY = '__no_priority__'
/** Human label for the {@link NO_PRIORITY_KEY} bucket. */
export const NO_PRIORITY_LABEL = 'No priority'

/**
 * Rank map over the user's configured priority order (index 0 = lowest level).
 *
 * Single source of priority ranking for every trophy surface — the room's
 * gallery sort and the table's column sort both read from here, so custom
 * levels rank identically on both.
 */
export function priorityRankMap(priorities: readonly { id: string }[]): Map<string, number> {
  const rank = new Map<string, number>()
  priorities.forEach((p, i) => rank.set(p.id, i))
  return rank
}

/**
 * Ascending priority comparator (lowest configured level first).
 * Ids outside the configured set sink below the lowest level.
 */
export function comparePriority(
  a: string | null | undefined,
  b: string | null | undefined,
  rank: Map<string, number>
): number {
  return (rank.get(a ?? '') ?? -1) - (rank.get(b ?? '') ?? -1)
}

/**
 * Counts by RAW priority id — a user-defined level keeps its own bucket instead
 * of being folded into 'medium'. Names and colors are the caller's job
 * (`resolvePriority`); `order` is the caller's configured id list, highest
 * level first. Ids outside `order` (and the no-priority bucket) sort last.
 */
export function breakdownByPriority(
  tasks: TrophyDatum[],
  order: readonly string[] = []
): BreakdownRow[] {
  const counts = new Map<string, number>()
  for (const t of tasks) {
    const raw = typeof t.priority === 'string' ? t.priority.trim() : ''
    const key = raw.length > 0 ? raw : NO_PRIORITY_KEY
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const rank = new Map<string, number>()
  order.forEach((id, i) => rank.set(id, i))
  const rankOf = (key: string) => rank.get(key) ?? Number.MAX_SAFE_INTEGER

  const total = tasks.length || 1
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === NO_PRIORITY_KEY ? NO_PRIORITY_LABEL : key,
      count,
      share: count / total,
    }))
    .sort(
      (a, b) => rankOf(a.key) - rankOf(b.key) || b.count - a.count || a.key.localeCompare(b.key)
    )
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

// ---------------------------------------------------------------------------
// Chart selectors: rolling trend, cycle time, weekly rhythm, deltas, formatting
// ---------------------------------------------------------------------------

/**
 * Trailing mean over `window` points. Early points average whatever is
 * available so the line starts at index 0 instead of leaving a gap.
 */
export function rollingMean(values: readonly number[], window: number): number[] {
  const span = Math.max(1, Math.floor(window))
  const out: number[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= span) sum -= values[i - span]
    out.push(sum / Math.min(i + 1, span))
  }
  return out
}

export interface CycleBucket {
  key: string
  label: string
  /** Inclusive day range; `max` is null for the open-ended tail. */
  min: number
  max: number | null
  count: number
}

export interface CycleTimeDistribution {
  buckets: CycleBucket[]
  /** Trophies with a recorded daysTaken. */
  sample: number
  median: number | null
  p90: number | null
}

const CYCLE_BUCKETS: ReadonlyArray<Omit<CycleBucket, 'count'>> = [
  { key: 'same-day', label: 'Same day', min: 0, max: 0 },
  { key: '1-2d', label: '1–2d', min: 1, max: 2 },
  { key: '3-5d', label: '3–5d', min: 3, max: 5 },
  { key: '1-2w', label: '1–2w', min: 6, max: 14 },
  { key: '2-4w', label: '2–4w', min: 15, max: 30 },
  { key: '1m+', label: '1m+', min: 31, max: null },
]

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * frac) * 10) / 10
}

/** Lead-time histogram over `daysTaken` (created -> completed), fixed buckets. */
export function cycleTimeDistribution(tasks: TrophyDatum[]): CycleTimeDistribution {
  const days: number[] = []
  for (const t of tasks) {
    if (typeof t.daysTaken === 'number' && Number.isFinite(t.daysTaken) && t.daysTaken >= 0) {
      days.push(t.daysTaken)
    }
  }
  const buckets = CYCLE_BUCKETS.map((b) => ({ ...b, count: 0 }))
  for (const d of days) {
    const b = buckets.find((x) => d >= x.min && (x.max === null || d <= x.max))
    if (b) b.count++
  }
  const sorted = [...days].sort((a, b) => a - b)
  return {
    buckets,
    sample: days.length,
    median: days.length ? percentile(sorted, 0.5) : null,
    p90: days.length ? percentile(sorted, 0.9) : null,
  }
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface RhythmHeatmap {
  /** 7 rows (Mon..Sun) x 24 hour columns, local time. */
  cells: number[][]
  max: number
  total: number
  peak: { day: number; hour: number; count: number } | null
}

/** When trophies land: completions by weekday x hour of day. */
export function completionHeatmap(tasks: TrophyDatum[]): RhythmHeatmap {
  const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  let max = 0
  let peak: RhythmHeatmap['peak'] = null
  for (const t of tasks) {
    const d = validTrophyDate(t)
    if (!d) continue
    const day = (d.getDay() + 6) % 7
    const hour = d.getHours()
    const n = ++cells[day][hour]
    if (n > max) {
      max = n
      peak = { day, hour, count: n }
    }
  }
  return { cells, max, total: tasks.length, peak }
}

/** Trophies whose celebration date is strictly after `since`. */
export function countSince(tasks: TrophyDatum[], since: Date | null): number {
  if (!since) return 0
  const cutoff = since.getTime()
  let n = 0
  for (const t of tasks) {
    const d = validTrophyDate(t)
    if (d && d.getTime() > cutoff) n++
  }
  return n
}

/** 1,284 / 12.9K / 1.2M — compact for tiles, comma-grouped below 10K. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return n.toLocaleString('en-US')
}

/** Whole days read as "3d", fractional as "3.5d"; null reads as an em dash. */
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return '—'
  const rounded = Math.round(days * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}d`
}

/** Hour label in 12-hour form: 0 -> "12am", 13 -> "1pm". */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base}${h < 12 ? 'am' : 'pm'}`
}
