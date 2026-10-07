import { describe, expect, it } from 'vitest'
import { DRIFT_PROBES, DRIFT_PROBE_IDS, DRIFT_PROBE_SET_VERSION, findDriftProbe } from '../probes'
import { DRIFT_PROBE_SYSTEM_PROMPT } from '../prompts'

describe('drift probes', () => {
  it('keeps the stable id contract (baselines key vectors by these ids)', () => {
    expect(DRIFT_PROBE_IDS).toEqual([
      'priorities-01', 'priorities-02', 'priorities-03', 'priorities-04',
      'trade-offs-01', 'trade-offs-02', 'trade-offs-03', 'trade-offs-04',
      'values-05', 'values-02', 'values-03', 'values-04',
      'nature-05', 'nature-06', 'nature-07', 'nature-08',
      'autonomy-05', 'autonomy-06', 'autonomy-07', 'autonomy-08',
      'contradictions-05', 'contradictions-06', 'contradictions-07', 'contradictions-08',
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
    expect(findDriftProbe('nature-05')?.question).toBe('What is Vorath?')
    expect(findDriftProbe('nope')).toBeUndefined()
  })

  it('names Vorath, never Kairos, and retires the reworded ids', () => {
    for (const p of DRIFT_PROBES) expect(p.question).not.toMatch(/Kairos/)
    for (const id of ['values-01', 'nature-01', 'autonomy-01', 'contradictions-01']) expect(findDriftProbe(id)).toBeUndefined()
    expect(DRIFT_PROBE_SET_VERSION).toBe(2)
    expect(DRIFT_PROBE_SYSTEM_PROMPT).toMatch(/^You are Vorath,/)
    expect(DRIFT_PROBE_SYSTEM_PROMPT).not.toMatch(/Kairos/)
  })
})
