import { describe, it, expect } from 'vitest'
import { nearestInsertionIndex, insertionIndexInFullOrder, reorderWithInsertion, buildMoveUpdates, type CardRect } from './dropIndex'

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

describe('insertionIndexInFullOrder', () => {
  // Column holds 10 tasks; a filter leaves only 3 visible (full indices 7,8,9).
  const fullOrder = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 'a', 'b', 'c']

  it('anchors on the visible card the pointer lands before, not the rect count', () => {
    expect(insertionIndexInFullOrder(80, rects, fullOrder)).toBe(7)   // before 'a'
    expect(insertionIndexInFullOrder(160, rects, fullOrder)).toBe(8)  // before 'b'
    expect(insertionIndexInFullOrder(260, rects, fullOrder)).toBe(9)  // before 'c'
  })

  it('lands after the last visible card when released below everything', () => {
    expect(insertionIndexInFullOrder(500, rects, fullOrder)).toBe(10)
  })

  it('matches visible indices exactly when nothing is filtered', () => {
    const unfiltered = ['a', 'b', 'c']
    expect(insertionIndexInFullOrder(80, rects, unfiltered)).toBe(0)
    expect(insertionIndexInFullOrder(160, rects, unfiltered)).toBe(1)
    expect(insertionIndexInFullOrder(500, rects, unfiltered)).toBe(3)
  })

  it('appends for an empty rect set (all cards filtered out or empty column)', () => {
    expect(insertionIndexInFullOrder(400, [], fullOrder)).toBe(10)
  })

  it('appends when the anchor rect id is unknown to the full order', () => {
    expect(insertionIndexInFullOrder(80, [{ id: 'ghost', top: 100, height: 100 }], ['x', 'y'])).toBe(2)
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

// Shared by the board's drag and Zen's drag — the two must never disagree
// about which rows a drop persists.
describe('buildMoveUpdates', () => {
  const order = [
    { id: 'a', orderIndex: 0 },
    { id: 'b', orderIndex: 1 },
    { id: 'c', orderIndex: 2 },
  ]

  it('only emits the rows whose index actually changed', () => {
    // 'c' hops to the front: 'a' and 'b' shift, and all three are rewritten.
    expect(buildMoveUpdates(['c', 'a', 'b'], order, { id: 'c', columnId: 'col-1', name: 'Gamma' })).toEqual([
      { id: 'c', orderIndex: 0, columnId: 'col-1', name: 'Gamma' },
      { id: 'a', orderIndex: 1 },
      { id: 'b', orderIndex: 2 },
    ])
  })

  it('leaves untouched siblings out of the write', () => {
    // 'b' and 'c' swap: 'a' keeps index 0 and must not be persisted again.
    expect(buildMoveUpdates(['a', 'c', 'b'], order, { id: 'b', columnId: 'col-1', name: 'Beta' })).toEqual([
      { id: 'c', orderIndex: 1 },
      { id: 'b', orderIndex: 2, columnId: 'col-1', name: 'Beta' },
    ])
  })

  it('carries the moved card even when its index did not move', () => {
    // Cross-column drop landing at the same ordinal still needs the columnId.
    expect(buildMoveUpdates(['a', 'b', 'c'], order, { id: 'b', columnId: 'col-2', name: 'Beta' })).toEqual([
      { id: 'b', orderIndex: 1, columnId: 'col-2', name: 'Beta' },
    ])
  })

  it('adds status only when one was asked for', () => {
    const [moved] = buildMoveUpdates(['b', 'a', 'c'], order, { id: 'b', columnId: 'done', name: 'Beta', status: 'done' })
    expect(moved).toEqual({ id: 'b', orderIndex: 0, columnId: 'done', name: 'Beta', status: 'done' })
    const [plain] = buildMoveUpdates(['b', 'a', 'c'], order, { id: 'b', columnId: 'col-1', name: 'Beta' })
    expect('status' in plain).toBe(false)
  })

  it('gives a card arriving from another column a contiguous index', () => {
    // 'x' is not in the destination's current order — every card it pushed
    // down is still rewritten, and none share an index.
    const updates = buildMoveUpdates(['a', 'x', 'b', 'c'], order, { id: 'x', columnId: 'col-1', name: 'Xi' })
    expect(updates).toEqual([
      { id: 'x', orderIndex: 1, columnId: 'col-1', name: 'Xi' },
      { id: 'b', orderIndex: 2 },
      { id: 'c', orderIndex: 3 },
    ])
  })
})
