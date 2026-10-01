import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import {
  DRIFT_MEAN_ALERT,
  DRIFT_PROBE_FLIP,
  compareToBaseline,
  driftAlert,
  isPackedVector,
  packVector,
  unpackVector,
} from '../drift'
import { cosine } from '@/lib/kairos/beliefs/cosine'

// Non-zero vector: at least one component bounded away from 0.
const vec = (len: number) =>
  fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: len, maxLength: len })
    .filter((v) => v.some((x) => Math.abs(x) > 1e-3))

describe('driftAlert (doc 34 §2: mean < 0.8 OR ≥ 3 probes < 0.6)', () => {
  it('alerts on a low mean alone', () => {
    expect(driftAlert(0.79, [0.79, 0.79])).toBe(true)
    expect(driftAlert(DRIFT_MEAN_ALERT, [0.8, 0.8])).toBe(false)
  })

  it('alerts on three flipped probes even with a healthy mean', () => {
    const sims = [0.59, 0.59, 0.59, ...new Array(21).fill(0.99)]
    expect(driftAlert(0.9, sims)).toBe(true)
    expect(driftAlert(0.9, [0.59, 0.59, DRIFT_PROBE_FLIP, ...new Array(21).fill(0.99)])).toBe(false)
  })

  test.prop([fc.array(fc.double({ min: DRIFT_PROBE_FLIP, max: 1, noNaN: true }), { minLength: 1, maxLength: 30 })])(
    'never alerts when every probe is ≥ 0.6 and the mean ≥ 0.8',
    (sims) => {
      const mean = sims.reduce((s, x) => s + x, 0) / sims.length
      expect(driftAlert(mean, sims)).toBe(mean < DRIFT_MEAN_ALERT)
    },
  )
})

describe('compareToBaseline', () => {
  const ids = ['a', 'b', 'c', 'd']

  test.prop([fc.array(vec(8), { minLength: 4, maxLength: 4 })])('identical answers → mean 1, no alert', (vs) => {
    const m = new Map(ids.map((id, i) => [id, vs[i]]))
    const cmp = compareToBaseline(m, m, ids)
    expect(cmp?.mean).toBe(1)
    expect(cmp?.perProbe.every((p) => p.sim === 1)).toBe(true)
    expect(cmp?.alert).toBe(false)
    expect(cmp?.flipped).toEqual([])
  })

  it('compares only shared probes, in order, and flags flips', () => {
    const base = new Map([['a', [1, 0]], ['b', [1, 0]], ['c', [1, 0]], ['d', [1, 0]]])
    const cur = new Map([['d', [0, 1]], ['c', [0, 1]], ['b', [0, 1]], ['x', [1, 0]]])
    const cmp = compareToBaseline(base, cur, ids)
    expect(cmp?.perProbe.map((p) => p.probeId)).toEqual(['b', 'c', 'd'])
    expect(cmp?.mean).toBe(0)
    expect(cmp?.flipped).toEqual(['b', 'c', 'd'])
    expect(cmp?.alert).toBe(true)
  })

  it('returns null when nothing overlaps', () => {
    expect(compareToBaseline(new Map([['a', [1]]]), new Map([['b', [1]]]), ['a', 'b'])).toBeNull()
  })
})

describe('packVector / unpackVector', () => {
  test.prop([vec(64)])('round-trips with cosine ≥ 0.999', (v) => {
    const packed = packVector(v)
    expect(isPackedVector(JSON.parse(JSON.stringify(packed)))).toBe(true)
    const back = unpackVector(packed)
    expect(back).toHaveLength(v.length)
    expect(cosine(v, back)).toBeGreaterThan(0.999)
  })

  it('stores a 1024-dim vector compactly', () => {
    const v = Array.from({ length: 1024 }, (_, i) => Math.sin(i))
    expect(JSON.stringify(packVector(v)).length).toBeLessThan(1500)
  })

  it('handles the zero vector', () => {
    expect(unpackVector(packVector([0, 0, 0]))).toEqual([0, 0, 0])
  })
})
