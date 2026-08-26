/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBoardPinchZoom } from '../useBoardPinchZoom'
import { MIN_BOARD_SCALE, SNAP_TO_NORMAL_THRESHOLD } from '../pinchZoom'

// The pure gesture math lives in pinchZoom.test.ts. This file pins the WIRING:
// which fingers own the gesture, when the transform is written, when it snaps
// back — and above all that a stray extra finger can never hand the pinch back
// to the browser (native page zoom = the black-void escape from the app canvas).

const BASE_WIDTH = 2000
const BASE_HEIGHT = 800

type TouchLike = { identifier: number; clientX: number; clientY: number }

function touchEvent(type: string, touches: TouchLike[]): Event {
  // jsdom ships no TouchEvent constructor; the hook only ever reads
  // `event.touches` and calls preventDefault, so a plain Event carrying the
  // list is behaviourally identical.
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'touches', { value: touches })
  return ev
}

let container: HTMLDivElement
let content: HTMLDivElement

function mountHook() {
  return renderHook(() => {
    const api = useBoardPinchZoom()
    // Assigned during render so the hook's mount effect sees live nodes.
    api.containerRef.current = container
    api.contentRef.current = content
    return api
  })
}

beforeEach(() => {
  container = document.createElement('div')
  content = document.createElement('div')
  container.appendChild(content)
  document.body.appendChild(container)
  Object.defineProperty(content, 'offsetWidth', { value: BASE_WIDTH, configurable: true })
  Object.defineProperty(content, 'offsetHeight', { value: BASE_HEIGHT, configurable: true })
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** Two fingers 200px apart — the reference gesture every test opens with. */
const OPEN: TouchLike[] = [
  { identifier: 1, clientX: 100, clientY: 300 },
  { identifier: 2, clientX: 300, clientY: 300 },
]
/** Same two fingers closed to `spread` px apart. */
const closedTo = (spread: number, extra: TouchLike[] = []): TouchLike[] => [
  { identifier: 1, clientX: 100, clientY: 300 },
  { identifier: 2, clientX: 100 + spread, clientY: 300 },
  ...extra,
]

describe('useBoardPinchZoom — gesture lifecycle', () => {
  it('a two-finger pinch scales the content and compensates the layout box', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))

    expect(content.style.transform).toBe('scale(0.5)')
    expect(content.style.transformOrigin).toBe('0 0')
    expect(content.style.marginRight).toBe(`${-0.5 * BASE_WIDTH}px`)
    expect(content.style.marginBottom).toBe(`${-0.5 * BASE_HEIGHT}px`)
  })

  it('a single finger never opens a gesture and is left to the browser', () => {
    mountHook()
    const start = touchEvent('touchstart', [OPEN[0]])
    container.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)

    container.dispatchEvent(touchEvent('touchmove', [{ identifier: 1, clientX: 900, clientY: 300 }]))
    expect(content.style.transform).toBe('')
  })

  it('clamps at the bird\'s-eye floor however far the fingers close', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(1)))
    expect(content.style.transform).toBe(`scale(${MIN_BOARD_SCALE})`)
  })

  it('ending a gesture ABOVE the snap threshold resets to a pristine board', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    // 190/200 = 0.95, above the 0.92 snap threshold.
    container.dispatchEvent(touchEvent('touchmove', closedTo(190)))
    expect(content.style.transform).toBe('scale(0.95)')
    expect(0.95).toBeGreaterThan(SNAP_TO_NORMAL_THRESHOLD)

    container.dispatchEvent(touchEvent('touchend', []))

    // Inline styles cleared entirely — not "scale(1)" left behind, which would
    // keep a compositing layer (and its blurry text) alive on the whole board.
    expect(content.style.transform).toBe('')
    expect(content.style.transformOrigin).toBe('')
    expect(content.style.marginRight).toBe('')
    expect(content.style.marginBottom).toBe('')
  })

  it('ending a gesture BELOW the snap threshold holds the zoomed-out view', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    container.dispatchEvent(touchEvent('touchend', []))

    expect(content.style.transform).toBe('scale(0.5)')
    expect(content.style.marginRight).toBe(`${-0.5 * BASE_WIDTH}px`)
  })

  it('a fresh pinch resumes from the held scale rather than from 1', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100))) // -> 0.5
    container.dispatchEvent(touchEvent('touchend', []))

    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(300))) // 1.5x of 0.5
    expect(content.style.transform).toBe('scale(0.75)')
  })

  it('touchcancel tears the gesture down like touchend', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(190)))
    container.dispatchEvent(touchEvent('touchcancel', []))
    expect(content.style.transform).toBe('')
  })

  it('unmount unbinds the listeners', () => {
    const { unmount } = mountHook()
    unmount()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('')
  })
})

describe('useBoardPinchZoom — a third finger stays contained', () => {
  it('does not reseat the gesture onto the newcomer', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN)) // 200px apart, scale 1
    container.dispatchEvent(touchEvent('touchmove', closedTo(100))) // -> 0.5
    expect(content.style.transform).toBe('scale(0.5)')

    // A third finger joins. TouchList order is NOT guaranteed to be arrival
    // order (Safari reorders), so the newcomer can land at touches[0] — the
    // slot a naive re-seat would read. Re-seating here would rebuild the
    // gesture as {finger3, finger1} with an 80px start distance, and the pinch
    // would stop tracking the fingers the user is actually pinching with.
    const third = { identifier: 3, clientX: 180, clientY: 300 }
    const join = touchEvent('touchstart', [third, { identifier: 1, clientX: 100, clientY: 300 }, { identifier: 2, clientX: 200, clientY: 300 }])
    container.dispatchEvent(join)
    // Still swallowed — the board owns every multi-finger gesture on it.
    expect(join.defaultPrevented).toBe(true)

    // Original pair spreads back to its opening 200px: the gesture that opened
    // this pinch says "back to scale 1", so the board goes pristine.
    container.dispatchEvent(touchEvent('touchmove', closedTo(200, [third])))
    expect(content.style.transform).toBe('')
  })

  it('keeps preventing default while an extra finger is down', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    const move = touchEvent('touchmove', closedTo(100, [{ identifier: 3, clientX: 500, clientY: 500 }]))
    container.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(true)
  })

  it('lifting only the extra finger does NOT end the pinch', () => {
    mountHook()
    const third = { identifier: 3, clientX: 500, clientY: 500 }
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(190, [third]))) // 0.95, would snap

    // touchend with the gesture's own two fingers still listed: not our end.
    container.dispatchEvent(touchEvent('touchend', closedTo(190)))
    expect(content.style.transform).toBe('scale(0.95)')

    // The pinch is genuinely still live — it keeps tracking.
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('lifting one of the OWN fingers ends the pinch even with a stray still down', () => {
    mountHook()
    const third = { identifier: 3, clientX: 500, clientY: 500 }
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(190, [third])))

    // Finger 2 lifted; only finger 1 and the stray remain — a raw touch count
    // would keep this dead gesture alive.
    container.dispatchEvent(touchEvent('touchend', [OPEN[0], third]))
    expect(content.style.transform).toBe('')

    // And a later move from the leftovers is inert.
    container.dispatchEvent(touchEvent('touchmove', [OPEN[0], third]))
    expect(content.style.transform).toBe('')
  })
})

// Owner-reported 2026-08-26: "you zoom out and there's nothing below" — the
// columns kept their own height, shrank toward the origin and left the bottom
// of the screen empty. Zooming out must fill the viewport at every scale so it
// reads as a bird's-eye view of the board rather than a shrunken postage stamp.
describe('useBoardPinchZoom — bird\'s-eye fill', () => {
  const VIEWPORT_HEIGHT = 600

  beforeEach(() => {
    Object.defineProperty(container, 'clientHeight', { value: VIEWPORT_HEIGHT, configurable: true })
  })

  it('lays the wrapper out at viewport / scale so it still reaches the bottom edge', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))

    // scale 0.5 -> laid out at double height, so 0.5 * 1200 == the viewport.
    expect(content.style.height).toBe(`${VIEWPORT_HEIGHT / 0.5}px`)
    expect(content.dataset.boardZoomed).toBe('')
    // Compensation follows the new layout height, not the columns' own.
    expect(content.style.marginBottom).toBe(`${-0.5 * (VIEWPORT_HEIGHT / 0.5)}px`)
  })

  it('fills at the furthest zoom-out too', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(1)))

    expect(content.style.height).toBe(`${VIEWPORT_HEIGHT / MIN_BOARD_SCALE}px`)
  })

  it('releases the fill when the board snaps back to normal scale', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    // End just inside the snap threshold so the board returns to scale 1.
    container.dispatchEvent(touchEvent('touchmove', closedTo(200 * SNAP_TO_NORMAL_THRESHOLD + 1)))
    container.dispatchEvent(touchEvent('touchend', []))

    expect(content.style.height).toBe('')
    expect(content.dataset.boardZoomed).toBeUndefined()
  })

  it('leaves grid layout to its own wrapped height', () => {
    content.dataset.boardLayout = 'grid'
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))

    expect(content.style.height).toBe('')
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('re-fits to the new viewport when the device rotates mid-zoom', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    container.dispatchEvent(touchEvent('touchend', []))

    Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true })
    window.dispatchEvent(new Event('resize'))

    expect(content.style.height).toBe(`${900 / 0.5}px`)
  })
})
