/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { canAutoScroll } from '../boardAutoScroll'

// The window is never auto-scrolled by a drag; inner scrollers still are.

describe('canAutoScroll', () => {
  it('refuses the document, its root and the body', () => {
    expect(canAutoScroll(document.documentElement)).toBe(false)
    expect(canAutoScroll(document.body)).toBe(false)
    if (document.scrollingElement) expect(canAutoScroll(document.scrollingElement)).toBe(false)
  })

  it('allows any other scroll container', () => {
    const column = document.createElement('div')
    document.body.appendChild(column)
    expect(canAutoScroll(column)).toBe(true)
  })
})
