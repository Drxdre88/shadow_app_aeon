import { describe, it, expect } from 'vitest'
import { arrangeItemDrag, resolveDropGroup } from './reorder'
import type { ChecklistItem } from './types'

function item(id: string, groupName: string): ChecklistItem {
  return { id, title: id, completed: false, state: 'unchecked', status: null, groupName }
}

// Two groups: A=[a1,a2,a3], B=[b1,b2]
const items: ChecklistItem[] = [
  item('a1', 'A'), item('a2', 'A'), item('a3', 'A'),
  item('b1', 'B'), item('b2', 'B'),
]
const groups = ['A', 'B']

const order = (r: { id: string; groupName: string }[] | null) => r?.map((x) => `${x.id}:${x.groupName}`)

describe('resolveDropGroup', () => {
  it('maps an item id to its group', () => {
    expect(resolveDropGroup(items, groups, 'b1')).toBe('B')
  })
  it('maps a group name to itself (drop on the group area)', () => {
    expect(resolveDropGroup(items, groups, 'B')).toBe('B')
  })
  it('returns null for an unknown target', () => {
    expect(resolveDropGroup(items, groups, 'zzz')).toBeNull()
  })
})

describe('arrangeItemDrag — intra-group', () => {
  it('reorders within a group and leaves groups intact', () => {
    // drag a1 onto a3 (move down)
    expect(order(arrangeItemDrag(items, groups, 'a1', 'a3'))).toEqual([
      'a2:A', 'a3:A', 'a1:A', 'b1:B', 'b2:B',
    ])
  })
  it('is a no-op when dropped on itself', () => {
    expect(arrangeItemDrag(items, groups, 'a1', 'a1')).toBeNull()
  })
})

describe('arrangeItemDrag — cross-group', () => {
  it('moves an item into another group before the item it landed on', () => {
    // drag a1 onto b2 → a1 becomes group B, inserted before b2
    expect(order(arrangeItemDrag(items, groups, 'a1', 'b2'))).toEqual([
      'a2:A', 'a3:A', 'b1:B', 'a1:B', 'b2:B',
    ])
  })
  it('appends to the end when dropped on the group area itself', () => {
    // drag a1 onto group B (empty-area / header drop)
    expect(order(arrangeItemDrag(items, groups, 'a1', 'B'))).toEqual([
      'a2:A', 'a3:A', 'b1:B', 'b2:B', 'a1:B',
    ])
  })
  it('moves the last item of a group into an empty group', () => {
    const withEmpty = [item('a1', 'A'), item('a2', 'A')]
    // group C exists in displayGroups but has no items
    expect(order(arrangeItemDrag(withEmpty, ['A', 'C'], 'a2', 'C'))).toEqual([
      'a1:A', 'a2:C',
    ])
  })
  it('keeps an empty target group in its on-screen slot (does not shunt it to the bottom)', () => {
    // displayGroups A,C,B where C is empty and sits in the middle
    const twoItems = [item('a1', 'A'), item('b1', 'B')]
    expect(order(arrangeItemDrag(twoItems, ['A', 'C', 'B'], 'a1', 'C'))).toEqual([
      'a1:C', 'b1:B',
    ])
  })

  it('returns null when the dragged item does not exist', () => {
    expect(arrangeItemDrag(items, groups, 'ghost', 'b1')).toBeNull()
  })
})
