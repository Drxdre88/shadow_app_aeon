import { describe, it, expect, vi } from 'vitest'

// memories.ts eagerly constructs the DB client on import; the recency helpers
// are pure, so a bare mock keeps the module loadable.
vi.mock('@/lib/db', () => ({ db: {} }))

import { RECENCY_HALF_LIFE_DAYS, recencyDecay, recencyMultiplier } from '../memories'

const NOW = new Date('2026-07-24T12:00:00.000Z').getTime()
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000)

describe('shared recency curve (true 14-day half-life)', () => {
  it('decay is exactly 0.5 at one half-life and 0.25 at two', () => {
    expect(RECENCY_HALF_LIFE_DAYS).toBe(14)
    expect(recencyDecay(daysAgo(14), NOW)).toBeCloseTo(0.5, 10)
    expect(recencyDecay(daysAgo(28), NOW)).toBeCloseTo(0.25, 10)
  })

  it('multiplier is 1.3 fresh, 1.15 at one half-life, ×1 without a createdAt', () => {
    expect(recencyMultiplier(daysAgo(0), NOW)).toBeCloseTo(1.3, 10)
    expect(recencyMultiplier(daysAgo(14), NOW)).toBeCloseTo(1.15, 10)
    expect(recencyMultiplier(null, NOW)).toBe(1)
    expect(recencyMultiplier(undefined, NOW)).toBe(1)
  })

  it('never exceeds the fresh ceiling for a future-dated row', () => {
    expect(recencyMultiplier(new Date(NOW + 5 * 86_400_000), NOW)).toBeCloseTo(1.3, 10)
  })
})
