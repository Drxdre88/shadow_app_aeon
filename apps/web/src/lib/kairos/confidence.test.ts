import { describe, it, expect } from 'vitest'
import {
  effectiveConfidence,
  confidenceBoost,
  CONFIDENCE_HALF_LIFE_DAYS,
  CONFIDENCE_DECAY_FLOOR,
  CONFIDENCE_NEUTRAL,
  CONFIDENCE_WEIGHT,
} from './confidence'

const NOW = Date.UTC(2026, 6, 9) // fixed clock so decay math is deterministic
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000)

describe('effectiveConfidence', () => {
  it('returns the raw prior when just reinforced (age ≈ 0)', () => {
    expect(effectiveConfidence({ confidence: 0.9, updatedAt: daysAgo(0) }, NOW)).toBeCloseTo(0.9, 5)
  })

  it('halves the decayable weight at exactly one half-life', () => {
    const prior = 0.9
    const eff = effectiveConfidence({ confidence: prior, updatedAt: daysAgo(CONFIDENCE_HALF_LIFE_DAYS) }, NOW)
    const factor = CONFIDENCE_DECAY_FLOOR + (1 - CONFIDENCE_DECAY_FLOOR) * 0.5
    expect(eff).toBeCloseTo(prior * factor, 5)
  })

  it('decays monotonically with age', () => {
    const at = (d: number) => effectiveConfidence({ confidence: 0.9, updatedAt: daysAgo(d) }, NOW)
    expect(at(0)).toBeGreaterThan(at(30))
    expect(at(30)).toBeGreaterThan(at(180))
    expect(at(180)).toBeGreaterThan(at(720))
  })

  it('never falls below the floored prior, however old', () => {
    const prior = 0.9
    const ancient = effectiveConfidence({ confidence: prior, updatedAt: daysAgo(100_000) }, NOW)
    expect(ancient).toBeGreaterThanOrEqual(prior * CONFIDENCE_DECAY_FLOOR - 1e-9)
    expect(ancient).toBeCloseTo(prior * CONFIDENCE_DECAY_FLOOR, 3)
  })

  it('exempts pinned memories from decay entirely (raw prior kept for rendering)', () => {
    const old = { confidence: 0.9, updatedAt: daysAgo(1000), pinned: true }
    expect(effectiveConfidence(old, NOW)).toBe(0.9)
  })

  it('returns the raw prior (not NaN) for an unparseable updatedAt', () => {
    expect(effectiveConfidence({ confidence: 0.7, updatedAt: 'not-a-date' }, NOW)).toBe(0.7)
  })

  it('falls back to neutral when there is no stored prior', () => {
    expect(effectiveConfidence({ confidence: null, updatedAt: daysAgo(10) }, NOW)).toBe(CONFIDENCE_NEUTRAL)
    expect(effectiveConfidence({ confidence: undefined, updatedAt: daysAgo(10) }, NOW)).toBe(CONFIDENCE_NEUTRAL)
  })

  it('returns the raw prior when updatedAt is missing', () => {
    expect(effectiveConfidence({ confidence: 0.7 }, NOW)).toBe(0.7)
  })
})

describe('confidenceBoost', () => {
  it('is neutral (×1) for a missing prior', () => {
    expect(confidenceBoost({ confidence: null, updatedAt: daysAgo(10) }, NOW)).toBe(1)
  })

  it('is neutral (×1) for a mid-confidence memory at the pivot', () => {
    expect(confidenceBoost({ confidence: CONFIDENCE_NEUTRAL, updatedAt: daysAgo(0) }, NOW)).toBeCloseTo(1, 5)
  })

  it('is a true ×1 for pinned memories regardless of prior or age', () => {
    expect(confidenceBoost({ confidence: 0.9, updatedAt: daysAgo(0), pinned: true }, NOW)).toBe(1)
    expect(confidenceBoost({ confidence: 0.3, updatedAt: daysAgo(500), pinned: true }, NOW)).toBe(1)
  })

  it('boosts fresh high-trust memory above 1', () => {
    expect(confidenceBoost({ confidence: 0.9, updatedAt: daysAgo(0) }, NOW)).toBeGreaterThan(1)
  })

  it('dims low-trust memory below 1', () => {
    expect(confidenceBoost({ confidence: 0.3, updatedAt: daysAgo(0) }, NOW)).toBeLessThan(1)
  })

  it('dims a decayed belief relative to its fresh self', () => {
    const fresh = confidenceBoost({ confidence: 0.9, updatedAt: daysAgo(0) }, NOW)
    const stale = confidenceBoost({ confidence: 0.9, updatedAt: daysAgo(365) }, NOW)
    expect(stale).toBeLessThan(fresh)
    expect(stale).toBeGreaterThan(0) // always a nudge, never a gate
  })

  it('matches the pivot formula exactly', () => {
    const eff = effectiveConfidence({ confidence: 0.6, updatedAt: daysAgo(45) }, NOW)
    expect(confidenceBoost({ confidence: 0.6, updatedAt: daysAgo(45) }, NOW)).toBeCloseTo(
      1 + (eff - CONFIDENCE_NEUTRAL) * CONFIDENCE_WEIGHT,
      5,
    )
  })
})
