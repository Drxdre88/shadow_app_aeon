/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { placementForDrag, pointerYFromEvent, readItemRects, samePlacement } from '../dropPlacement'
import { arrangeItemAt } from '../reorder'
import type { ChecklistItem } from '../types'

// Pins the checklist drop rule: the slot an item lands in comes from the
// pointer's row inside the target group (the board's gap rule), never from
// which row the collision detection happened to name.

function item(id: string, groupName: string): ChecklistItem {
  return { id, title: id, completed: false, state: 'unchecked', status: null, groupName }
}

// A=[a1,a2], B=[b1,b2,b3]
const items = [item('a1', 'A'), item('a2', 'A'), item('b1', 'B'), item('b2', 'B'), item('b3', 'B')]
const groups = ['A', 'B']

function mountGroup(name: string, rows: { id: string; top: number; height?: number }[]) {
  const group = document.createElement('div')
  group.setAttribute('data-checklist-group', name)
  for (const r of rows) {
    const el = document.createElement('div')
    el.setAttribute('data-checklist-item-id', r.id)
    const height = r.height ?? 40
    el.getBoundingClientRect = () => ({
      top: r.top, height, bottom: r.top + height, left: 0, right: 300, width: 300, x: 0, y: r.top, toJSON() {},
    }) as DOMRect
    group.appendChild(el)
  }
  document.body.appendChild(group)
}

function evt(activeId: string, overId: string | null, clientY: number, deltaY = 0) {
  return {
    active: { id: activeId, data: { current: { type: 'item' } }, rect: { current: { translated: null, initial: null } } },
    over: overId ? { id: overId } : null,
    delta: { x: 0, y: deltaY },
    activatorEvent: { clientY },
  } as unknown as Parameters<typeof placementForDrag>[2]
}

beforeAll(() => {
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
  else if (!CSS.escape) CSS.escape = (s: string) => s
})
afterEach(() => { document.body.innerHTML = '' })

describe('pointerYFromEvent', () => {
  it('adds the drag delta to the activating pointer', () => {
    expect(pointerYFromEvent(evt('a1', 'b1', 100, 35))).toBe(135)
  })
  it('falls back to the translated row centre for keyboard drags', () => {
    const e = evt('a1', 'b1', 0)
    ;(e as unknown as { activatorEvent: unknown }).activatorEvent = { key: 'ArrowDown' }
    ;(e.active.rect.current as { translated: unknown }).translated = { top: 200, height: 40 }
    expect(pointerYFromEvent(e)).toBe(220)
  })
})

describe('readItemRects', () => {
  it('reads the group rows, skipping the dragged one and zero-height rows', () => {
    mountGroup('B', [{ id: 'b1', top: 0 }, { id: 'b2', top: 44 }, { id: 'a1', top: 88 }, { id: 'b3', top: 132, height: 0 }])
    expect(readItemRects('B', 'a1')?.map((r) => r.id)).toEqual(['b1', 'b2'])
  })
  it('is null for a group without rendered rows', () => {
    expect(readItemRects('B', 'a1')).toBeNull()
    mountGroup('B', [])
    expect(readItemRects('B', 'a1')).toBeNull()
  })
})

describe('placementForDrag', () => {
  it('lands after the row whose midpoint the pointer passed (cross-group)', () => {
    mountGroup('B', [{ id: 'b1', top: 0 }, { id: 'b2', top: 44 }, { id: 'b3', top: 88 }])
    // Pointer at y=50: past b1's midpoint (20), before b2's (64) → slot 1.
    expect(placementForDrag(items, groups, evt('a1', 'b2', 50))).toEqual({ groupName: 'B', index: 1 })
    // Same slot whichever row the collision named, and when it named the group.
    expect(placementForDrag(items, groups, evt('a1', 'b1', 50))).toEqual({ groupName: 'B', index: 1 })
    expect(placementForDrag(items, groups, evt('a1', 'B', 50))).toEqual({ groupName: 'B', index: 1 })
    // Below the last midpoint → append.
    expect(placementForDrag(items, groups, evt('a1', 'B', 120))).toEqual({ groupName: 'B', index: 3 })
  })

  it('appends when the target group has no rendered rows (empty or collapsed)', () => {
    expect(placementForDrag(items, groups, evt('a1', 'B', 50))).toEqual({ groupName: 'B', index: 3 })
    expect(placementForDrag([...items, item('c1', 'C')].filter((i) => i.id !== 'c1'), [...groups, 'C'], evt('a1', 'C', 50)))
      .toEqual({ groupName: 'C', index: 0 })
  })

  it('ignores the dragged row itself when it is in the target group', () => {
    mountGroup('A', [{ id: 'a1', top: 0 }, { id: 'a2', top: 44 }])
    // Dragging a1 below a2's midpoint → slot 1 of [a2].
    expect(placementForDrag(items, groups, evt('a1', 'a2', 70))).toEqual({ groupName: 'A', index: 1 })
  })

  it('is null without a target or for a group drag', () => {
    expect(placementForDrag(items, groups, evt('a1', null, 50))).toBeNull()
    const e = evt('A', 'B', 50)
    ;(e.active.data.current as { type: string }).type = 'group'
    expect(placementForDrag(items, groups, e)).toBeNull()
  })
})

describe('samePlacement', () => {
  it('compares by value', () => {
    expect(samePlacement({ groupName: 'A', index: 1 }, { groupName: 'A', index: 1 })).toBe(true)
    expect(samePlacement({ groupName: 'A', index: 1 }, { groupName: 'A', index: 2 })).toBe(false)
    expect(samePlacement(null, { groupName: 'A', index: 0 })).toBe(false)
    expect(samePlacement(null, null)).toBe(true)
  })
})

const order = (r: { id: string; groupName: string }[] | null) => r?.map((x) => `${x.id}:${x.groupName}`)

describe('arrangeItemAt', () => {
  it('inserts a cross-group item at the slot', () => {
    expect(order(arrangeItemAt(items, groups, 'a1', 'B', 1))).toEqual(['a2:A', 'b1:B', 'a1:B', 'b2:B', 'b3:B'])
  })
  it('appends at slot = siblings.length', () => {
    expect(order(arrangeItemAt(items, groups, 'a1', 'B', 3))).toEqual(['a2:A', 'b1:B', 'b2:B', 'b3:B', 'a1:B'])
  })
  it('moves within the group, slots counted without the dragged row', () => {
    expect(order(arrangeItemAt(items, groups, 'b1', 'B', 1))).toEqual(['a1:A', 'a2:A', 'b2:B', 'b1:B', 'b3:B'])
    expect(order(arrangeItemAt(items, groups, 'b3', 'B', 0))).toEqual(['a1:A', 'a2:A', 'b3:B', 'b1:B', 'b2:B'])
  })
  it('fills an empty group without shunting it to the bottom', () => {
    const three = ['A', 'C', 'B']
    expect(order(arrangeItemAt(items, three, 'b2', 'C', 0))).toEqual(['a1:A', 'a2:A', 'b2:C', 'b1:B', 'b3:B'])
  })
  it('clamps out-of-range slots', () => {
    expect(order(arrangeItemAt(items, groups, 'a1', 'B', 99))).toEqual(['a2:A', 'b1:B', 'b2:B', 'b3:B', 'a1:B'])
    expect(order(arrangeItemAt(items, groups, 'a1', 'B', -5))).toEqual(['a2:A', 'a1:B', 'b1:B', 'b2:B', 'b3:B'])
  })
  it('is null for a no-op drop, an unknown item or an unknown group', () => {
    expect(arrangeItemAt(items, groups, 'b2', 'B', 1)).toBeNull()
    expect(arrangeItemAt(items, groups, 'zz', 'B', 0)).toBeNull()
    expect(arrangeItemAt(items, groups, 'a1', 'Z', 0)).toBeNull()
  })
})
