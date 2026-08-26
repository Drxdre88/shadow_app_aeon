import { describe, it, expect } from 'vitest'
import {
  trophyDate,
  bucketByPeriod,
  computeStreak,
  monthComparison,
  breakdownByPriority,
  breakdownByLabel,
  breakdownByColumn,
  sumSize,
  type TrophyDatum,
} from './trophy-stats'

const NOW = new Date('2026-08-26T12:00:00') // Wednesday

function t(completedAt: string | null, extra: Partial<TrophyDatum> = {}): TrophyDatum {
  return {
    completedAt,
    archivedAt: completedAt ?? '2026-08-01T10:00:00',
    ...extra,
  }
}

describe('trophyDate', () => {
  it('prefers completedAt over archivedAt', () => {
    const d = trophyDate({ completedAt: '2026-08-10T00:00:00', archivedAt: '2026-08-20T00:00:00' })
    expect(d.getDate()).toBe(10)
  })

  it('falls back to archivedAt when completion is missing', () => {
    const d = trophyDate({ completedAt: null, archivedAt: '2026-08-20T00:00:00' })
    expect(d.getDate()).toBe(20)
  })
})

describe('bucketByPeriod', () => {
  it('zero-fills contiguous month buckets ending at the current month', () => {
    const buckets = bucketByPeriod([], 'month', 6, NOW)
    expect(buckets).toHaveLength(6)
    expect(buckets.map((b) => b.label)).toEqual(['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'])
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })

  it('counts trophies into the right month buckets', () => {
    const tasks = [
      t('2026-08-02T09:00:00'),
      t('2026-08-25T09:00:00'),
      t('2026-07-15T09:00:00'),
      t('2026-01-01T09:00:00'), // outside window — ignored
    ]
    const buckets = bucketByPeriod(tasks, 'month', 3, NOW)
    expect(buckets.map((b) => b.count)).toEqual([0, 1, 2])
  })

  it('buckets by ISO-ish weeks starting Monday', () => {
    const tasks = [
      t('2026-08-24T08:00:00'), // Monday this week
      t('2026-08-26T08:00:00'), // Wednesday this week
      t('2026-08-23T08:00:00'), // Sunday -> previous week
    ]
    const buckets = bucketByPeriod(tasks, 'week', 2, NOW)
    expect(buckets[0].count).toBe(1)
    expect(buckets[1].count).toBe(2)
  })
})

describe('computeStreak', () => {
  it('returns zeros for no trophies', () => {
    expect(computeStreak([], 'day', NOW)).toEqual({ current: 0, best: 0 })
    expect(computeStreak([], 'week', NOW)).toEqual({ current: 0, best: 0 })
  })

  it('counts a current day streak ending today', () => {
    const tasks = [
      t('2026-08-26T09:00:00'),
      t('2026-08-25T09:00:00'),
      t('2026-08-24T09:00:00'),
    ]
    expect(computeStreak(tasks, 'day', NOW)).toEqual({ current: 3, best: 3 })
  })

  it('keeps the streak alive if today has no trophy yet but yesterday does', () => {
    const tasks = [t('2026-08-25T09:00:00'), t('2026-08-24T09:00:00')]
    expect(computeStreak(tasks, 'day', NOW).current).toBe(2)
  })

  it('resets current streak after a full missed day, but remembers the best run', () => {
    const tasks = [
      t('2026-08-20T09:00:00'),
      t('2026-08-21T09:00:00'),
      t('2026-08-22T09:00:00'),
      t('2026-08-23T09:00:00'), // 4-day historical run, broken on the 24th
      t('2026-08-26T09:00:00'), // today
    ]
    expect(computeStreak(tasks, 'day', NOW)).toEqual({ current: 1, best: 4 })
  })

  it('multiple trophies in one day count as one streak day', () => {
    const tasks = [t('2026-08-26T09:00:00'), t('2026-08-26T18:00:00')]
    expect(computeStreak(tasks, 'day', NOW)).toEqual({ current: 1, best: 1 })
  })

  it('counts week streaks across consecutive weeks', () => {
    const tasks = [
      t('2026-08-26T09:00:00'), // this week
      t('2026-08-19T09:00:00'), // last week
      t('2026-08-12T09:00:00'), // two weeks ago
      t('2026-07-01T09:00:00'), // long gap
    ]
    expect(computeStreak(tasks, 'week', NOW)).toEqual({ current: 3, best: 3 })
  })

  it('week streak survives an empty current week via the previous week', () => {
    const tasks = [t('2026-08-19T09:00:00'), t('2026-08-12T09:00:00')]
    expect(computeStreak(tasks, 'week', NOW).current).toBe(2)
  })
})

describe('monthComparison', () => {
  it('splits counts between this month and last month', () => {
    const tasks = [
      t('2026-08-01T09:00:00'),
      t('2026-08-26T09:00:00'),
      t('2026-07-31T09:00:00'),
      t('2026-06-30T09:00:00'), // older — ignored
    ]
    expect(monthComparison(tasks, NOW)).toEqual({ thisMonth: 2, lastMonth: 1, deltaPct: 100 })
  })

  it('returns null delta when last month had none', () => {
    const tasks = [t('2026-08-10T09:00:00')]
    expect(monthComparison(tasks, NOW).deltaPct).toBeNull()
  })

  it('computes negative deltas', () => {
    const tasks = [
      t('2026-08-10T09:00:00'),
      t('2026-07-10T09:00:00'),
      t('2026-07-11T09:00:00'),
    ]
    expect(monthComparison(tasks, NOW).deltaPct).toBe(-50)
  })
})

describe('breakdownByPriority', () => {
  it('orders urgent -> low and skips empty priorities', () => {
    const tasks = [
      t('2026-08-01T09:00:00', { priority: 'low' }),
      t('2026-08-02T09:00:00', { priority: 'urgent' }),
      t('2026-08-03T09:00:00', { priority: 'low' }),
    ]
    const rows = breakdownByPriority(tasks)
    expect(rows.map((r) => r.key)).toEqual(['urgent', 'low'])
    expect(rows.map((r) => r.count)).toEqual([1, 2])
    expect(rows[1].share).toBeCloseTo(2 / 3)
  })

  it('treats unknown priorities as medium', () => {
    const rows = breakdownByPriority([t('2026-08-01T09:00:00', { priority: 'bananas' })])
    expect(rows).toEqual([{ key: 'medium', label: 'Medium', count: 1, share: 1 }])
  })
})

describe('breakdownByLabel', () => {
  it('counts multi-labelled trophies once per label and sorts by count', () => {
    const tasks = [
      t('2026-08-01T09:00:00', { labelSnapshot: [{ name: 'API', color: 'cyan' }, { name: 'UI', color: 'pink' }] }),
      t('2026-08-02T09:00:00', { labelSnapshot: [{ name: 'ui', color: 'pink' }] }),
      t('2026-08-03T09:00:00', { labelSnapshot: [] }),
    ]
    const rows = breakdownByLabel(tasks)
    expect(rows.map((r) => r.label)).toEqual(['UI', 'API', 'Unlabeled'])
    expect(rows[0].count).toBe(2)
    expect(rows[0].color).toBe('pink')
    expect(rows[2].count).toBe(1)
  })

  it('caps named labels at top N but always appends Unlabeled', () => {
    const tasks = [
      ...['a', 'b', 'c'].map((n, i) =>
        t(`2026-08-0${i + 1}T09:00:00`, { labelSnapshot: [{ name: n, color: 'red' }] })
      ),
      t('2026-08-04T09:00:00', { labelSnapshot: [] }),
    ]
    const rows = breakdownByLabel(tasks, 2)
    expect(rows).toHaveLength(3)
    expect(rows[2].key).toBe('unlabeled')
  })

  it('tolerates malformed label snapshots', () => {
    const tasks = [
      t('2026-08-01T09:00:00', { labelSnapshot: [{ color: 'red' }, null] }),
      t('2026-08-02T09:00:00', { labelSnapshot: undefined }),
    ]
    const rows = breakdownByLabel(tasks)
    expect(rows).toEqual([{ key: 'unlabeled', label: 'Unlabeled', count: 2, share: 1 }])
  })
})

describe('breakdownByColumn', () => {
  it('groups by origin column with a fallback bucket', () => {
    const tasks = [
      t('2026-08-01T09:00:00', { columnName: 'Done' }),
      t('2026-08-02T09:00:00', { columnName: 'Done' }),
      t('2026-08-03T09:00:00', { columnName: null }),
    ]
    const rows = breakdownByColumn(tasks)
    expect(rows[0]).toMatchObject({ label: 'Done', count: 2 })
    expect(rows[1]).toMatchObject({ label: 'Board', count: 1 })
  })
})

describe('sumSize', () => {
  it('sums numeric sizes and ignores nulls', () => {
    const tasks = [
      t('2026-08-01T09:00:00', { size: 1.5 }),
      t('2026-08-02T09:00:00', { size: 2 }),
      t('2026-08-03T09:00:00', { size: null }),
    ]
    expect(sumSize(tasks)).toBe(3.5)
  })

  it('returns 0 for empty input', () => {
    expect(sumSize([])).toBe(0)
  })
})
