import { describe, it, expect, vi } from 'vitest'

// memories.ts eagerly constructs the DB client on import; recencyDecay is
// pure and never touches it, so a bare mock keeps the module loadable.
vi.mock('@/lib/db', () => ({ db: {} }))

import { recencyDecay } from '../memories'

// Pure function, no DB — a future-dated createdAt (clock skew, a bad
// backfill, a stray test fixture) must clamp at daysOld=0 rather than
// exceeding the intended 1-boost ceiling.

const NOW = new Date('2026-07-24T12:00:00.000Z').getTime()

describe('recencyDecay', () => {
  it('returns 1 (no decay) for a createdAt exactly at now', () => {
    expect(recencyDecay(new Date(NOW), NOW)).toBeCloseTo(1, 10)
  })

  it('clamps a future-dated createdAt to the same ceiling as now — never exceeds it', () => {
    const future = new Date(NOW + 7 * 86_400_000) // 7 days in the future
    expect(recencyDecay(future, NOW)).toBeCloseTo(recencyDecay(new Date(NOW), NOW), 10)
    expect(recencyDecay(future, NOW)).toBeLessThanOrEqual(1)
  })

  it('decays below 1 for a genuinely past createdAt', () => {
    const past = new Date(NOW - 14 * 86_400_000) // one half-life ago
    const value = recencyDecay(past, NOW)
    expect(value).toBeLessThan(1)
    expect(value).toBeCloseTo(Math.exp(-1), 5)
  })

  it('approaches 0 for a very old createdAt', () => {
    const ancient = new Date(NOW - 365 * 86_400_000)
    expect(recencyDecay(ancient, NOW)).toBeLessThan(0.01)
  })
})
