import { describe, it, expect } from 'vitest'
import { planMoveAllToColumn, maxOrderIndex } from '../bulkMovePlan'

describe('planMoveAllToColumn', () => {
  it('appends after the target max, preserving the source order', () => {
    const source = [
      { id: 'c', orderIndex: 7 },
      { id: 'a', orderIndex: 2 },
      { id: 'b', orderIndex: 5 },
    ]
    expect(planMoveAllToColumn(source, 3)).toEqual([
      { id: 'a', orderIndex: 4 },
      { id: 'b', orderIndex: 5 },
      { id: 'c', orderIndex: 6 },
    ])
  })

  it('starts at 0 for an empty target (max -1)', () => {
    expect(planMoveAllToColumn([{ id: 'x', orderIndex: 9 }], -1)).toEqual([{ id: 'x', orderIndex: 0 }])
  })

  it('returns nothing for an empty source and never mutates its input', () => {
    const source = [{ id: 'b', orderIndex: 2 }, { id: 'a', orderIndex: 1 }]
    expect(planMoveAllToColumn([], 4)).toEqual([])
    planMoveAllToColumn(source, 4)
    expect(source.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('maxOrderIndex', () => {
  it('is -1 for no tasks and the largest index otherwise', () => {
    expect(maxOrderIndex([])).toBe(-1)
    expect(maxOrderIndex([{ orderIndex: 3 }, { orderIndex: 11 }, { orderIndex: 0 }])).toBe(11)
  })
})
