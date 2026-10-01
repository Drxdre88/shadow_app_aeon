import { describe, expect, it } from 'vitest'
import { DRIFT_PROBES, DRIFT_PROBE_IDS, findDriftProbe } from '../probes'

describe('drift probes', () => {
  it('keeps the stable id contract (baselines key vectors by these ids)', () => {
    expect(DRIFT_PROBE_IDS).toEqual([
      'priorities-01', 'priorities-02', 'priorities-03', 'priorities-04',
      'trade-offs-01', 'trade-offs-02', 'trade-offs-03', 'trade-offs-04',
      'values-01', 'values-02', 'values-03', 'values-04',
      'nature-01', 'nature-02', 'nature-03', 'nature-04',
      'autonomy-01', 'autonomy-02', 'autonomy-03', 'autonomy-04',
      'contradictions-01', 'contradictions-02', 'contradictions-03', 'contradictions-04',
    ])
  })

  it('has 20–30 unique probes with non-empty questions across every category', () => {
    expect(DRIFT_PROBES.length).toBeGreaterThanOrEqual(20)
    expect(DRIFT_PROBES.length).toBeLessThanOrEqual(30)
    expect(new Set(DRIFT_PROBE_IDS).size).toBe(DRIFT_PROBES.length)
    expect(new Set(DRIFT_PROBES.map((p) => p.question)).size).toBe(DRIFT_PROBES.length)
    for (const p of DRIFT_PROBES) expect(p.question.trim().length).toBeGreaterThan(5)
    expect(new Set(DRIFT_PROBES.map((p) => p.category))).toEqual(
      new Set(['priorities', 'trade_offs', 'values', 'nature', 'autonomy', 'contradictions']),
    )
  })

  it('looks probes up by id', () => {
    expect(findDriftProbe('nature-01')?.question).toBe('What is Kairos?')
    expect(findDriftProbe('nope')).toBeUndefined()
  })
})
