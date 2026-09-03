/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBoardPinchZoom } from '../useBoardPinchZoom'
import { getBoardZoom, publishBoardZoom } from '../boardZoom'

// Owner-reported 2026-09-02: dragging a card between columns while zoomed out
// shrank the canvas and opened dead space beside it. Two things the hook now
// guarantees around a drag: a stray second finger cannot open a pinch while a
// card is lifted, and a layout change under the zoom re-fits the wrapper so
// the scroll range never runs past the visible board. The gesture maths and
// lifecycle live in useBoardPinchZoom.test.ts; helpers are mirrored here.

const BASE_WIDTH = 2000
const BASE_HEIGHT = 800

type TouchLike = { identifier: number; clientX: number; clientY: number }

function touchEvent(type: string, touches: TouchLike[]): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: touches })
  return ev
}

let container: HTMLDivElement
let content: HTMLDivElement

function mountHook(isLocked?: () => boolean) {
  return renderHook(() => {
    const api = useBoardPinchZoom(isLocked ? { isLocked } : undefined)
    api.containerRef.current = container
    api.contentRef.current = content
    return api
  })
}

const OPEN: TouchLike[] = [
  { identifier: 1, clientX: 100, clientY: 300 },
  { identifier: 2, clientX: 300, clientY: 300 },
]
const closedTo = (spread: number): TouchLike[] => [
  { identifier: 1, clientX: 100, clientY: 300 },
  { identifier: 2, clientX: 100 + spread, clientY: 300 },
]

function pinchToHalfAndRelease() {
  container.dispatchEvent(touchEvent('touchstart', OPEN))
  container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
  container.dispatchEvent(touchEvent('touchend', []))
}

beforeEach(() => {
  container = document.createElement('div')
  content = document.createElement('div')
  container.appendChild(content)
  document.body.appendChild(container)
  Object.defineProperty(content, 'offsetWidth', { value: BASE_WIDTH, configurable: true })
  Object.defineProperty(content, 'offsetHeight', { value: BASE_HEIGHT, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
})

afterEach(() => {
  document.body.innerHTML = ''
  publishBoardZoom(1)
})

describe('useBoardPinchZoom — drag interplay', () => {
  it('refuses a new pinch while locked and leaves the touches to dnd-kit', () => {
    let locked = true
    mountHook(() => locked)
    const start = touchEvent('touchstart', OPEN)
    container.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('')

    // Unlocked again: the next pinch is ours.
    locked = false
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('a pinch already open when the lock engages keeps its own fingers', () => {
    let locked = false
    mountHook(() => locked)
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    locked = true
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('writes the live scale where dnd-kit measuring can read it, and clears it at 1', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.dataset.boardZoom).toBe('0.5')
    container.dispatchEvent(touchEvent('touchmove', closedTo(200)))
    expect(content.dataset.boardZoom).toBeUndefined()
  })

  it('publishes the settled zoom at gesture end, never per frame', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(getBoardZoom()).toBe(1)
    container.dispatchEvent(touchEvent('touchend', []))
    expect(getBoardZoom()).toBe(0.5)
  })

  it('resets the published zoom on unmount', () => {
    const { unmount } = mountHook()
    pinchToHalfAndRelease()
    expect(getBoardZoom()).toBe(0.5)
    unmount()
    expect(getBoardZoom()).toBe(1)
  })
})

describe('useBoardPinchZoom — re-fit when the layout changes under the zoom', () => {
  let callbacks: Array<() => void>
  let observed: Element[]

  beforeEach(() => {
    callbacks = []
    observed = []
    class FakeResizeObserver {
      constructor(cb: () => void) { callbacks.push(cb) }
      observe(el: Element) { observed.push(el) }
      disconnect() { callbacks.length = 0 }
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: FakeResizeObserver, configurable: true, writable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('observes both the container and the wrapper', () => {
    mountHook()
    expect(observed).toContain(container)
    expect(observed).toContain(content)
  })

  it('recomputes the margin compensation when the unscaled width changes mid-zoom', () => {
    mountHook()
    pinchToHalfAndRelease()
    expect(content.style.marginRight).toBe(`${-0.5 * BASE_WIDTH}px`)

    // A card left a dynamically-sized column: the columns are now narrower.
    Object.defineProperty(content, 'offsetWidth', { value: BASE_WIDTH - 200, configurable: true })
    for (const cb of callbacks) cb()

    expect(content.style.marginRight).toBe(`${-0.5 * (BASE_WIDTH - 200)}px`)
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('re-fits the height when the container grows (URL bar hides, filter bar closes)', () => {
    mountHook()
    pinchToHalfAndRelease()
    expect(content.style.height).toBe(`${600 / 0.5}px`)

    Object.defineProperty(container, 'clientHeight', { value: 700, configurable: true })
    for (const cb of callbacks) cb()
    expect(content.style.height).toBe(`${700 / 0.5}px`)
  })

  it('ignores a rounding-pixel jitter and does nothing at normal scale', () => {
    mountHook()
    for (const cb of callbacks) cb()
    expect(content.style.transform).toBe('')

    pinchToHalfAndRelease()
    const before = content.style.height
    Object.defineProperty(container, 'clientHeight', { value: 601, configurable: true })
    for (const cb of callbacks) cb()
    expect(content.style.height).toBe(before)
  })

  it('stops observing on unmount', () => {
    const { unmount } = mountHook()
    pinchToHalfAndRelease()
    unmount()
    expect(callbacks).toHaveLength(0)
  })
})
