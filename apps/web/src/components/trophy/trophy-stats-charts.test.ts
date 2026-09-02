import { describe, it, expect } from 'vitest'
import {
  bucketByPeriod,
  rollingMean,
  cycleTimeDistribution,
  completionHeatmap,
  countSince,
  formatCount,
  formatDays,
  formatHour,
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

describe('bucketByPeriod (days)', () => {
  it('zero-fills contiguous day buckets ending today', () => {
    const buckets = bucketByPeriod([], 'day', 7, NOW)
    expect(buckets).toHaveLength(7)
    expect(buckets[0].label).toBe('20 Aug')
    expect(buckets[6].label).toBe('26 Aug')
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })

  it('counts trophies into their local day', () => {
    const tasks = [
      t('2026-08-26T00:30:00'),
      t('2026-08-26T23:30:00'),
      t('2026-08-25T12:00:00'),
      t('2026-08-01T12:00:00'),
    ]
    const buckets = bucketByPeriod(tasks, 'day', 3, NOW)
    expect(buckets.map((b) => b.count)).toEqual([0, 1, 2])
  })
})

describe('rollingMean', () => {
  it('averages over the trailing window, partial at the start', () => {
    expect(rollingMean([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7])
  })

  it('degrades to the identity for a window of 1 (or less)', () => {
    expect(rollingMean([1, 5, 2], 1)).toEqual([1, 5, 2])
    expect(rollingMean([1, 5, 2], 0)).toEqual([1, 5, 2])
  })

  it('handles an empty series', () => {
    expect(rollingMean([], 7)).toEqual([])
  })
})

describe('cycleTimeDistribution', () => {
  it('reports an empty distribution when no trophy recorded days taken', () => {
    const d = cycleTimeDistribution([t('2026-08-20T10:00:00'), t('2026-08-21T10:00:00', { daysTaken: null })])
    expect(d.sample).toBe(0)
    expect(d.median).toBeNull()
    expect(d.p90).toBeNull()
    expect(d.buckets.map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('places lead times into fixed buckets and reports median / p90', () => {
    const days = [0, 1, 2, 4, 7, 14, 20, 45, 3, 1]
    const d = cycleTimeDistribution(days.map((n) => t('2026-08-20T10:00:00', { daysTaken: n })))
    expect(d.sample).toBe(10)
    expect(d.buckets.map((b) => `${b.label}:${b.count}`)).toEqual([
      'Same day:1',
      '1–2d:3',
      '3–5d:2',
      '1–2w:2',
      '2–4w:1',
      '1m+:1',
    ])
    expect(d.median).toBe(3.5)
    expect(d.p90).toBe(22.5)
  })

  it('ignores negative and non-finite values', () => {
    const d = cycleTimeDistribution([
      t('2026-08-20T10:00:00', { daysTaken: -3 }),
      t('2026-08-20T10:00:00', { daysTaken: Number.NaN }),
      t('2026-08-20T10:00:00', { daysTaken: 2 }),
    ])
    expect(d.sample).toBe(1)
    expect(d.median).toBe(2)
  })
})

describe('completionHeatmap', () => {
  it('is a 7x24 zero grid with no peak for an empty vault', () => {
    const h = completionHeatmap([])
    expect(h.cells).toHaveLength(7)
    expect(h.cells.every((row) => row.length === 24 && row.every((c) => c === 0))).toBe(true)
    expect(h.max).toBe(0)
    expect(h.peak).toBeNull()
  })

  it('counts by Monday-first weekday and local hour, and finds the peak', () => {
    const h = completionHeatmap([
      t('2026-08-24T09:15:00'), // Monday 9am
      t('2026-08-24T09:45:00'), // Monday 9am
      t('2026-08-30T22:05:00'), // Sunday 10pm
    ])
    expect(h.cells[0][9]).toBe(2)
    expect(h.cells[6][22]).toBe(1)
    expect(h.total).toBe(3)
    expect(h.max).toBe(2)
    expect(h.peak).toEqual({ day: 0, hour: 9, count: 2 })
  })
})

describe('countSince', () => {
  it('counts trophies strictly after the cutoff, and 0 with no cutoff', () => {
    const tasks = [t('2026-08-20T10:00:00'), t('2026-08-25T10:00:00'), t('2026-08-26T10:00:00')]
    expect(countSince(tasks, null)).toBe(0)
    expect(countSince(tasks, new Date('2026-08-25T10:00:00'))).toBe(1)
    expect(countSince(tasks, new Date('2026-08-01T00:00:00'))).toBe(3)
  })
})

describe('formatting', () => {
  it('formats counts compactly', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1284)).toBe('1,284')
    expect(formatCount(12900)).toBe('12.9K')
    expect(formatCount(20000)).toBe('20K')
    expect(formatCount(1_200_000)).toBe('1.2M')
    expect(formatCount(Number.NaN)).toBe('—')
  })

  it('formats days and hours', () => {
    expect(formatDays(null)).toBe('—')
    expect(formatDays(3)).toBe('3d')
    expect(formatDays(3.46)).toBe('3.5d')
    expect(formatHour(0)).toBe('12am')
    expect(formatHour(9)).toBe('9am')
    expect(formatHour(12)).toBe('12pm')
    expect(formatHour(23)).toBe('11pm')
  })
})
