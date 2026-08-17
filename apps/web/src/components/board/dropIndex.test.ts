import { describe, it, expect } from 'vitest'
import { nearestInsertionIndex, reorderWithInsertion, type CardRect } from './dropIndex'

const rects: CardRect[] = [
  { id: 'a', top: 100, height: 100 },
  { id: 'b', top: 200, height: 100 },
  { id: 'c', top: 300, height: 100 },
]

describe('nearestInsertionIndex', () => {
  it('inserts at the top when the pointer is above the first card', () => {
    expect(nearestInsertionIndex(80, rects)).toBe(0)
    expect(nearestInsertionIndex(140, rects)).toBe(0)
  })

  it('inserts into the gap the pointer is nearest to', () => {
    expect(nearestInsertionIndex(160, rects)).toBe(1)
    expect(nearestInsertionIndex(260, rects)).toBe(2)
  })

  it('appends when the pointer is below every card', () => {
    expect(nearestInsertionIndex(500, rects)).toBe(3)
  })

  it('appends at 0 for an empty column', () => {
    expect(nearestInsertionIndex(400, [])).toBe(0)
  })

  it('ignores DOM order and uses vertical position', () => {
    const shuffled = [rects[2], rects[0], rects[1]]
    expect(nearestInsertionIndex(260, shuffled)).toBe(2)
  })
})

describe('reorderWithInsertion', () => {
  it('moves a card down inside its own column', () => {
    expect(reorderWithInsertion(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
  })

  it('moves a card up inside its own column', () => {
    expect(reorderWithInsertion(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
  })

  it('inserts a card arriving from another column', () => {
    expect(reorderWithInsertion(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b'])
  })

  it('clamps an out-of-range index', () => {
    expect(reorderWithInsertion(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x'])
    expect(reorderWithInsertion(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b'])
  })
})
