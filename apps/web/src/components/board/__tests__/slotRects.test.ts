/** @vitest-environment jsdom */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { inlineTranslateY, readCardSlotRects } from '../dropIndex'
import { findCardAtY } from '../useFuseIntent'

// Regression for the owner's "fusion never arms — a drop always lands above or
// below" (0309): while a card is dragged over another, the sortable strategy
// slides the hovered card away with an inline translate, so the rect visually
// under the pointer was the gap. Fusion must target the SLOT.

beforeAll(() => {
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
  else if (!CSS.escape) CSS.escape = (s: string) => s
})
afterEach(() => { document.body.innerHTML = '' })

function card(col: Element, id: string, top: number, height: number, translateY?: number) {
  const el = document.createElement('div')
  el.setAttribute('data-task-id', id)
  if (translateY !== undefined) el.style.transform = `translate3d(0px, ${translateY}px, 0) scaleX(1) scaleY(1)`
  Object.defineProperty(el, 'offsetHeight', { value: height })
  el.getBoundingClientRect = () => ({
    top: top + (translateY ?? 0), height, bottom: top + (translateY ?? 0) + height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON() {},
  }) as DOMRect
  col.appendChild(el)
  return el
}

describe('slot rects', () => {
  it('reads the inline sortable displacement', () => {
    const col = document.createElement('div')
    col.setAttribute('data-column-id', 'c1')
    document.body.appendChild(col)
    expect(inlineTranslateY(card(col, 'a', 0, 40))).toBe(0)
    expect(inlineTranslateY(card(col, 'b', 40, 40, 44))).toBe(44)
    expect(inlineTranslateY(card(col, 'c', 80, 40, -44))).toBe(-44)
  })

  it('the slot under the pointer is the displaced card, not the gap', () => {
    const col = document.createElement('div')
    col.setAttribute('data-column-id', 'c1')
    document.body.appendChild(col)
    // Dragging `active` (slot 0) over `b` (slot 1): b is displaced 44px down.
    card(col, 'active', 0, 40)
    card(col, 'b', 44, 40, 44)
    card(col, 'c', 88, 40, 44)
    const pointerInMiddleOfBSlot = 44 + 20
    // Visually there is a gap at y=64 — but the slot belongs to b.
    const rects = readCardSlotRects('c1', 'active')!
    expect(rects.map((r) => [r.id, r.top])).toEqual([['b', 44], ['c', 88]])
    expect(findCardAtY('c1', 'active', pointerInMiddleOfBSlot)?.id).toBe('b')
  })

  it('a hidden or missing column yields null', () => {
    expect(readCardSlotRects('nope')).toBeNull()
  })
})
