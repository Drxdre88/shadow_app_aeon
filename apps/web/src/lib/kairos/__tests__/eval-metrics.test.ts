import { describe, it, expect } from 'vitest'
import {
  recallAtK,
  precisionAtK,
  reciprocalRank,
  mrr,
  hitRate,
} from '../eval-metrics'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const D = 'dddddddd-0000-4000-8000-000000000004'
const E = 'eeeeeeee-0000-4000-8000-000000000005'

describe('recallAtK', () => {
  it('full overlap within k', () => {
    expect(recallAtK([A, B, C], [A, B], 5)).toBe(1)
  })

  it('partial overlap — 1 of 2 relevant in top-3', () => {
    expect(recallAtK([A, C, D], [A, B], 3)).toBeCloseTo(0.5)
  })

  it('zero overlap', () => {
    expect(recallAtK([C, D, E], [A, B], 5)).toBe(0)
  })

  it('relevant beyond k cutoff not counted', () => {
    // B is at position 4 (index 3), k=3 — should not count
    expect(recallAtK([A, C, D, B], [A, B], 3)).toBeCloseTo(0.5)
  })

  it('empty relevantIds returns 0', () => {
    expect(recallAtK([A, B], [], 5)).toBe(0)
  })

  it('k larger than result list — uses all results', () => {
    expect(recallAtK([A, B], [A, B, C], 100)).toBeCloseTo(2 / 3)
  })
})

describe('precisionAtK', () => {
  it('all top-k relevant', () => {
    expect(precisionAtK([A, B, C], [A, B, C, D], 3)).toBe(1)
  })

  it('half top-k relevant', () => {
    expect(precisionAtK([A, C, B, D], [A, B], 4)).toBeCloseTo(0.5)
  })

  it('zero relevant in top-k', () => {
    expect(precisionAtK([C, D], [A, B], 2)).toBe(0)
  })

  it('k=0 returns 0', () => {
    expect(precisionAtK([A, B], [A], 0)).toBe(0)
  })

  it('empty retrieved list returns 0', () => {
    expect(precisionAtK([], [A], 5)).toBe(0)
  })

  it('k larger than result list uses actual list length', () => {
    expect(precisionAtK([A, B], [A], 100)).toBeCloseTo(0.5)
  })
})

describe('reciprocalRank', () => {
  it('first hit at rank 1 → RR=1', () => {
    expect(reciprocalRank([A, B, C], [A])).toBe(1)
  })

  it('first hit at rank 3 → RR=1/3', () => {
    expect(reciprocalRank([C, D, A], [A])).toBeCloseTo(1 / 3)
  })

  it('no relevant in list → RR=0', () => {
    expect(reciprocalRank([C, D, E], [A, B])).toBe(0)
  })

  it('multiple relevant — uses first hit', () => {
    // A is at rank 2, B at rank 1
    expect(reciprocalRank([B, A, C], [A, B])).toBe(1)
  })

  it('empty retrieved → RR=0', () => {
    expect(reciprocalRank([], [A])).toBe(0)
  })

  it('empty relevant → RR=0', () => {
    expect(reciprocalRank([A, B], [])).toBe(0)
  })
})

describe('mrr', () => {
  it('single query RR=1 → MRR=1', () => {
    expect(mrr([1])).toBe(1)
  })

  it('two queries average correctly', () => {
    expect(mrr([1, 0.5])).toBeCloseTo(0.75)
  })

  it('all zeros → MRR=0', () => {
    expect(mrr([0, 0, 0])).toBe(0)
  })

  it('empty list → MRR=0', () => {
    expect(mrr([])).toBe(0)
  })
})

describe('hitRate', () => {
  it('all queries have a hit → 1.0', () => {
    expect(hitRate([[A, B], [C, D]], [[A], [C]], 5)).toBe(1)
  })

  it('half queries have a hit → 0.5', () => {
    expect(hitRate([[A, B], [C, D]], [[E], [C]], 5)).toBeCloseTo(0.5)
  })

  it('no queries have a hit → 0', () => {
    expect(hitRate([[A, B], [C, D]], [[E], [E]], 5)).toBe(0)
  })

  it('relevant beyond k not counted', () => {
    // B is relevant but at position 3, k=2
    expect(hitRate([[A, C, B]], [[B]], 2)).toBe(0)
  })

  it('empty query list → 0', () => {
    expect(hitRate([], [], 5)).toBe(0)
  })
})
