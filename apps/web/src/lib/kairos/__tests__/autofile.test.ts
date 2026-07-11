import { describe, it, expect, afterEach } from 'vitest'
import {
  AUTO_FILE_STREAMS,
  autoFileEligible,
  autoFileMinSim,
  autoFileText,
  cosineSimilarity,
  DEFAULT_AUTO_FILE_MIN_SIM,
} from '../autofile'
import { STREAM_CLASSES } from '../streamClass'

afterEach(() => {
  delete process.env.KAIROS_AUTO_FILE_MIN_SIM
})

describe('autoFileEligible', () => {
  it('allows operator/agent capture streams', () => {
    for (const s of ['idea', 'reflection', 'execution', 'agentic'] as const) {
      expect(autoFileEligible(s)).toBe(true)
    }
  })

  it('excludes every machine-synthesis stream (aether must never be auto-filed)', () => {
    for (const s of STREAM_CLASSES) {
      if (AUTO_FILE_STREAMS.has(s)) continue
      expect(autoFileEligible(s)).toBe(false)
    }
    expect(autoFileEligible('aether')).toBe(false)
    expect(autoFileEligible('cortex')).toBe(false)
    expect(autoFileEligible('snapshot')).toBe(false)
  })
})

describe('autoFileMinSim', () => {
  it('defaults when the env var is unset or garbage', () => {
    expect(autoFileMinSim()).toBe(DEFAULT_AUTO_FILE_MIN_SIM)
    process.env.KAIROS_AUTO_FILE_MIN_SIM = 'not-a-number'
    expect(autoFileMinSim()).toBe(DEFAULT_AUTO_FILE_MIN_SIM)
  })

  it('reads a valid override', () => {
    process.env.KAIROS_AUTO_FILE_MIN_SIM = '0.7'
    expect(autoFileMinSim()).toBe(0.7)
  })

  it('clamps out-of-range overrides into [0.3, 0.95]', () => {
    process.env.KAIROS_AUTO_FILE_MIN_SIM = '0.05'
    expect(autoFileMinSim()).toBe(0.3)
    process.env.KAIROS_AUTO_FILE_MIN_SIM = '1.5'
    expect(autoFileMinSim()).toBe(0.95)
  })
})

describe('cosineSimilarity', () => {
  it('returns 1 for identical direction, 0 for orthogonal, -1 for opposite', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 3])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('is scale-invariant and handles zero vectors without NaN', () => {
    expect(cosineSimilarity([0.1, 0.2], [10, 20])).toBeCloseTo(1)
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('autoFileText', () => {
  it('joins title + summary + body in the backfill document shape', () => {
    expect(autoFileText('T', 'S', 'B')).toBe('T\n\nS\n\nB')
  })

  it('drops a missing summary without leaving a blank segment', () => {
    expect(autoFileText('T', null, 'B')).toBe('T\n\nB')
    expect(autoFileText('T', undefined, 'B')).toBe('T\n\nB')
  })
})
