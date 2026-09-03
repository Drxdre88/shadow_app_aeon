/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useBoardDnD } from '../useBoardDnD'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
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

// The 250ms long-press window is the hole the owner fell into: dnd-kit has not
// called onDragStart yet, so nothing is "locked", but the finger on the card is
// already committing to a drag. A bracing thumb landing then used to open a
// pinch, preventDefault the drag's own touch and shrink the board under the
// card. The gate is age-based, so a deliberate two-finger pinch over a dense
// board (one finger unavoidably on a card) still works.
describe('useBoardPinchZoom — the long-press hold window', () => {
  let card: HTMLDivElement

  const cardTouch = (): TouchLike => ({ identifier: 1, clientX: 100, clientY: 300 })
  const secondTouch = (): TouchLike => ({ identifier: 2, clientX: 300, clientY: 300 })

  /** A touchstart that originates on a card and bubbles to the container. */
  function touchCard(touches: TouchLike[]): Event {
    const ev = touchEvent('touchstart', touches)
    card.dispatchEvent(ev)
    return ev
  }

  beforeEach(() => {
    vi.useFakeTimers()
    card = document.createElement('div')
    card.setAttribute('data-task-id', 'task-1')
    content.appendChild(card)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refuses a pinch when the second finger arrives long after a finger settled on a card', () => {
    mountHook()
    touchCard([cardTouch()])
    vi.advanceTimersByTime(300)

    const second = touchCard([cardTouch(), secondTouch()])
    expect(second.defaultPrevented).toBe(false)

    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('')
    expect(content.dataset.boardZoom).toBeUndefined()
  })

  it('still pinches when both fingers land together, one of them on a card', () => {
    mountHook()
    touchCard([cardTouch()])
    vi.advanceTimersByTime(50)

    const second = touchCard([cardTouch(), secondTouch()])
    expect(second.defaultPrevented).toBe(true)

    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('a finger resting on bare board never ages out of a pinch', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', [cardTouch()]))
    vi.advanceTimersByTime(3000)

    container.dispatchEvent(touchEvent('touchstart', [cardTouch(), secondTouch()]))
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('refuses simultaneous fingers outright once the drag lock is set', () => {
    const dragActive = { current: false }
    mountHook(() => dragActive.current)

    // dnd-kit's onDragStart fires: the lock is a ref, live immediately.
    dragActive.current = true
    const second = touchCard([cardTouch(), secondTouch()])
    expect(second.defaultPrevented).toBe(false)
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('')
  })

  it('releases the lock on drag end and forgets the aged card touch on touchend', () => {
    const dragActive = { current: true }
    mountHook(() => dragActive.current)
    touchCard([cardTouch()])
    vi.advanceTimersByTime(400)
    touchCard([cardTouch(), secondTouch()])
    expect(content.style.transform).toBe('')

    // Fingers up, drag over. The aged card touch must be forgotten too —
    // kept, it would refuse the very next pinch even with fresh fingers.
    container.dispatchEvent(touchEvent('touchend', []))
    dragActive.current = false

    touchCard([cardTouch()])
    touchCard([cardTouch(), secondTouch()])
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })

  it('lets an already-open pinch continue when a finger later settles on a card', () => {
    mountHook()
    container.dispatchEvent(touchEvent('touchstart', OPEN))
    vi.advanceTimersByTime(500)
    container.dispatchEvent(touchEvent('touchmove', closedTo(100)))
    expect(content.style.transform).toBe('scale(0.5)')
  })
})

// The other half of the gate. `isLocked` is only as timely as what it reads:
// the lock used to be an effect over the rendered `activeItem`, which lands a
// commit AFTER dnd-kit lifts the card — a whole frame in which a second finger
// was still accepted as a pinch. It is now a ref written inside
// handleDragStart, so it is true before React has rendered anything.
describe('useBoardDnD — the pinch lock is synchronous', () => {
  const COLUMNS = [{ id: 'col-1', projectId: 'p1', name: 'Todo', color: 'blue', icon: null, orderIndex: 0 }]
  const TASKS = [{
    id: 'task-1', projectId: 'p1', name: 'card', columnId: 'col-1', status: 'todo',
    priority: 'medium' as const, color: 'purple', labels: [], onTimeline: false, orderIndex: 0, metadata: {},
  }]

  const startEvent = { active: { id: 'task-1', data: { current: { type: 'task' } } } } as unknown as DragStartEvent
  const endEvent = { active: { id: 'task-1', data: { current: { type: 'task' } } }, over: null, delta: { x: 0, y: 0 } } as unknown as DragEndEvent

  function mountDnD() {
    useBoardStore.setState({ tasks: TASKS as never[], columns: COLUMNS as never[], movingTaskId: null })
    useHangarUiStore.setState({ projectId: null, config: { enabled: false, triggerColumnId: null }, missionEditorTaskId: null } as never)
    return renderHook(() => useBoardDnD({ projectTasks: TASKS as never[], sortedColumns: COLUMNS as never[] }))
  }

  it('is locked inside handleDragStart, before the render that exposes activeItem', () => {
    const { result } = mountDnD()
    expect(result.current.dragActiveRef.current).toBe(false)

    let lockedDuringStart = false
    let renderedActiveItem: unknown = 'unset'
    act(() => {
      result.current.handleDragStart(startEvent)
      lockedDuringStart = result.current.dragActiveRef.current
      renderedActiveItem = result.current.activeItem
    })

    expect(lockedDuringStart).toBe(true)
    expect(renderedActiveItem).toBeNull()
    expect(result.current.activeItem).not.toBeNull()
  })

  it('releases on drag end and on drag cancel', () => {
    const { result } = mountDnD()
    act(() => { result.current.handleDragStart(startEvent) })
    act(() => { result.current.handleDragEnd(endEvent) })
    expect(result.current.dragActiveRef.current).toBe(false)

    act(() => { result.current.handleDragStart(startEvent) })
    expect(result.current.dragActiveRef.current).toBe(true)
    act(() => { result.current.handleDragCancel() })
    expect(result.current.dragActiveRef.current).toBe(false)
  })
})
