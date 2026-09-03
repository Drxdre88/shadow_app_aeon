/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { anchorToCard, findCardElement } from '../popoverAnchor'

// While a column is in Zen mode every card in it exists twice in the DOM —
// the board copy (opacity 0, earlier in document order) and the visible
// Zen copy. Popovers must anchor to the one the user can see.

function card(id: string, parent: Element, rect: Partial<DOMRect>) {
  const el = document.createElement('div')
  el.setAttribute('data-task-id', id)
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rect,
  }) as DOMRect
  parent.appendChild(el)
  return el
}

// jsdom ships no CSS.escape; the ids here need no escaping.
beforeAll(() => {
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s }
  else if (!CSS.escape) CSS.escape = (s: string) => s
})

afterEach(() => { document.body.innerHTML = '' })

describe('findCardElement', () => {
  it('prefers the Zen copy over the hidden board copy', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    card('t1', board, { width: 200, height: 80, top: 100, bottom: 180, left: 10 })
    const zen = document.createElement('div')
    zen.setAttribute('data-zen-layer', '')
    document.body.appendChild(zen)
    const zenCard = card('t1', zen, { width: 320, height: 80, top: 300, bottom: 380, left: 500 })

    expect(findCardElement('t1')).toBe(zenCard)
    const pos = anchorToCard('t1', 240, 200)
    expect(pos.top).toBe(388)
    expect(pos.left).toBe(500)
  })

  it('falls back to the board copy when Zen is closed', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    const boardCard = card('t1', board, { width: 200, height: 80, top: 100, bottom: 180, left: 10 })
    expect(findCardElement('t1')).toBe(boardCard)
  })

  it('returns null for an unknown card', () => {
    expect(findCardElement('nope')).toBeNull()
  })
})
