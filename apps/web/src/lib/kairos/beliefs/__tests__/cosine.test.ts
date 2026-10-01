import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { cosine } from '../cosine'

// Non-zero vector: at least one component bounded away from 0.
const vec = (len: number) =>
  fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: len, maxLength: len })
    .filter((v) => v.some((x) => Math.abs(x) > 1e-3))

describe('cosine', () => {
  test.prop([vec(16)])('is 1 for a non-zero vector with itself', (v) => {
    expect(cosine(v, v)).toBeCloseTo(1, 9)
  })

  test.prop([vec(16), fc.double({ min: 0.01, max: 100, noNaN: true })])('is scale-invariant', (v, k) => {
    expect(cosine(v, v.map((x) => x * k))).toBeCloseTo(1, 9)
  })

  test.prop([vec(12), vec(12)])('is symmetric and clamped to [-1, 1]', (a, b) => {
    const c = cosine(a, b)
    expect(c).toBeGreaterThanOrEqual(-1)
    expect(c).toBeLessThanOrEqual(1)
    expect(c).toBeCloseTo(cosine(b, a), 12)
  })

  it('is 0 for zero, empty, mismatched or non-finite input and -1 for opposites', () => {
    expect(cosine([0, 0], [1, 2])).toBe(0)
    expect(cosine([], [])).toBe(0)
    expect(cosine([1, 0], [1, 0, 0])).toBe(0)
    expect(cosine([Infinity, 1], [1, 1])).toBe(0)
    expect(cosine([NaN, 1], [1, 1])).toBe(0)
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 12)
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })
})
