import { describe, it, expect } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { mergeGroupOrder, extendGroupOrderMemory, arrangeItemAdd } from '../groupOrder'
import type { ChecklistItem } from '../types'

function item(id: string, groupName: string): ChecklistItem {
  return { id, title: id, completed: false, state: 'unchecked', status: null, groupName }
}

// Live-reported bug: create groups "priority one/two/three" (still empty), add
// an item to a LOWER group while higher ones are empty → the lower group
// jumped to the top. Group order must be anchored by the order memory, never
// by which groups happen to have items.
describe('mergeGroupOrder', () => {
  it('keeps an empty-higher / filled-lower arrangement stable (the jump repro)', () => {
    const memory = ['priority one', 'priority two', 'priority three']
    // "priority three" got its first item → it is now item-derived; the two
    // higher groups are still empty ghosts.
    const merged = mergeGroupOrder(memory, ['priority three'], ['priority one', 'priority two'])
    expect(merged).toEqual(['priority one', 'priority two', 'priority three'])
  })

  it('keeps group order stable when items resurface groups in a different order', () => {
    // Legacy interleaved orderIndex data: deleting group A's first item makes
    // the items array surface B first — display order must not flip.
    expect(mergeGroupOrder(['A', 'B'], ['B', 'A'], [])).toEqual(['A', 'B'])
  })

  it('appends genuinely new groups after memorized ones', () => {
    expect(mergeGroupOrder(['A'], ['A', 'C'], ['G'])).toEqual(['A', 'C', 'G'])
  })

  it('prunes groups that no longer exist', () => {
    expect(mergeGroupOrder(['A', 'B', 'C'], ['A'], [])).toEqual(['A'])
  })

  it('dedupes overlapping item-derived and pending names', () => {
    expect(mergeGroupOrder(['A', 'A'], ['A', 'B'], ['B', 'A'])).toEqual(['A', 'B'])
  })

  it('empty memory falls back to item order then pending order', () => {
    expect(mergeGroupOrder([], ['C'], ['A', 'B'])).toEqual(['C', 'A', 'B'])
  })
})

describe('extendGroupOrderMemory', () => {
  it('appends only unseen groups', () => {
    expect(extendGroupOrderMemory(['A'], ['A', 'B', 'C'])).toEqual(['A', 'B', 'C'])
  })

  it('returns the same reference when nothing new appeared (no render loop)', () => {
    const memory = ['A', 'B']
    expect(extendGroupOrderMemory(memory, ['B', 'A'])).toBe(memory)
  })
})

describe('arrangeItemAdd', () => {
  it('plain append when no group order is given', () => {
    const items = [item('a1', 'A')]
    const { next, reindex } = arrangeItemAdd(items, item('n', 'A'))
    expect(next.map((i) => i.id)).toEqual(['a1', 'n'])
    expect(reindex).toBeNull()
  })

  it('needs no reindex when the item lands in the last displayed group', () => {
    const items = [item('a1', 'A'), item('b1', 'B')]
    const { next, reindex } = arrangeItemAdd(items, item('n', 'B'), ['A', 'B'])
    expect(next.map((i) => i.id)).toEqual(['a1', 'b1', 'n'])
    expect(reindex).toBeNull()
  })

  it('rewrites indices when adding to a group above others (reload parity for the repro)', () => {
    // "priority three" already has an item; user now adds the first item to
    // "priority one" (displayed above). Server append (MAX+1) would order the
    // groups three-then-one after reload — the reindex must fix that.
    const items = [item('t1', 'priority three')]
    const { next, reindex } = arrangeItemAdd(
      items,
      item('n', 'priority one'),
      ['priority one', 'priority two', 'priority three'],
    )
    expect(next.map((i) => i.id)).toEqual(['n', 't1'])
    expect(reindex).toEqual([
      { id: 'n', orderIndex: 0 },
      { id: 't1', orderIndex: 1 },
    ])
  })

  it('places the item at the end of its group block, before later groups', () => {
    const items = [item('a1', 'A'), item('b1', 'B')]
    const { next, reindex } = arrangeItemAdd(items, item('n', 'A'), ['A', 'B'])
    expect(next.map((i) => i.id)).toEqual(['a1', 'n', 'b1'])
    expect(reindex).toEqual([
      { id: 'a1', orderIndex: 0 },
      { id: 'n', orderIndex: 1 },
      { id: 'b1', orderIndex: 2 },
    ])
  })

  it('keeps items of unlisted groups at the end instead of dropping them', () => {
    const items = [item('x1', 'X')]
    const { next } = arrangeItemAdd(items, item('n', 'A'), ['A'])
    expect(next.map((i) => i.id)).toEqual(['n', 'x1'])
  })

  const groupPool = ['A', 'B', 'C', 'D']
  test.prop([
    fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 12 }),
    fc.integer({ min: 0, max: 3 }),
    fc.shuffledSubarray(groupPool),
  ])('preserves every item exactly once and per-group relative order', (groupIdxs, targetIdx, orderedGroups) => {
    const items = groupIdxs.map((g, i) => item(`i${i}`, groupPool[g]))
    const target = groupPool[targetIdx]
    const newItem = item('new', target)
    const { next, reindex } = arrangeItemAdd(items, newItem, orderedGroups)

    // No item lost or duplicated.
    expect([...next.map((i) => i.id)].sort()).toEqual(
      [...items.map((i) => i.id), 'new'].sort(),
    )
    // Relative order inside every group is untouched; the new item is last in its group.
    for (const g of groupPool) {
      const before = items.filter((i) => i.groupName === g).map((i) => i.id)
      const after = next.filter((i) => i.groupName === g).map((i) => i.id)
      expect(after).toEqual(g === target ? [...before, 'new'] : before)
    }
    // A reindex, when present, is a full contiguous rewrite in `next` order.
    if (reindex) {
      expect(reindex).toEqual(next.map((i, idx) => ({ id: i.id, orderIndex: idx })))
    } else {
      // No reindex means the append already matches: the new item is global-last.
      expect(next[next.length - 1].id).toBe('new')
    }
  })
})
