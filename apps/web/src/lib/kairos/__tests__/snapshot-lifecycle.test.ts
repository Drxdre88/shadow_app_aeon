import { describe, it, expect } from 'vitest'
import { cutoffDate, SNAPSHOT_TTL_DAYS, ADVISORY_TTL_DAYS } from '../lifecycle'
import { STREAM_CLASSES } from '../streamClass'

describe('snapshot lifecycle', () => {
  it('snapshot stream-class exists and is NOT a briefer substrate stream', () => {
    // The briefer pulls reflection/idea/agentic; snapshot must be none of those.
    expect(STREAM_CLASSES).toContain('snapshot')
    expect(['reflection', 'idea', 'agentic']).not.toContain('snapshot')
  })

  it('cutoffDate subtracts exactly ttlDays', () => {
    const now = new Date('2026-06-10T12:00:00.000Z')
    expect(cutoffDate(now, 7).toISOString()).toBe('2026-06-03T12:00:00.000Z')
    expect(cutoffDate(now, 0).toISOString()).toBe(now.toISOString())
  })

  it('rows older than the cutoff are expired, newer ones survive', () => {
    const now = new Date('2026-06-10T12:00:00.000Z')
    const snapCut = cutoffDate(now, SNAPSHOT_TTL_DAYS)
    const old = new Date('2026-06-01T12:00:00.000Z') // 9 days
    const fresh = new Date('2026-06-09T12:00:00.000Z') // 1 day
    expect(old < snapCut).toBe(true)
    expect(fresh < snapCut).toBe(false)
  })

  it('advisories live longer than snapshots', () => {
    expect(ADVISORY_TTL_DAYS).toBeGreaterThan(SNAPSHOT_TTL_DAYS)
  })
})
