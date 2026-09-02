/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardStore } from '@/lib/store/boardStore'
import {
  HOLD_TO_MOVE_DELAY_MS,
  HOLD_TO_MOVE_MAX_TRAVEL_PX,
  HOLD_RELEASE_MAX_TRAVEL_PX,
  halfFromPoint,
  isHoldRelease,
  placementIndex,
  useCardHoldGesture,
  useHoldToMoveMode,
} from '../useHoldToMove'

// The hold-to-move state machine: idle -> (hold) -> moving -> (place | cancel)
// -> idle. Desktop entry is a timed still press; touch entry is a dnd-kit drag
// released in place. Placement math is pure and pinned separately from the
// gesture wiring.

const TASK = 't1'

function pointer(over: Partial<React.PointerEvent> = {}): React.PointerEvent {
  return {
    pointerType: 'mouse',
    button: 0,
    clientX: 100,
    clientY: 100,
    target: document.createElement('div'),
    ...over,
  } as unknown as React.PointerEvent
}

describe('useCardHoldGesture (desktop hold)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useBoardStore.setState({ movingTaskId: null })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a still press for the delay lifts the card; its release click is swallowed once', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS - 1) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(useBoardStore.getState().movingTaskId).toBe(TASK)

    act(() => { result.current.holdHandlers.onPointerUp() })
    expect(result.current.consumeHoldClick()).toBe(true)
    // Only the ONE click that belongs to the hold is eaten.
    expect(result.current.consumeHoldClick()).toBe(false)
  })

  it('releasing before the delay is an ordinary click', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { vi.advanceTimersByTime(200) })
    act(() => { result.current.holdHandlers.onPointerUp() })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })

    expect(useBoardStore.getState().movingTaskId).toBeNull()
    expect(result.current.consumeHoldClick()).toBe(false)
  })

  it('travel at or beyond the tolerance aborts the hold (dnd-kit takes the gesture)', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { result.current.holdHandlers.onPointerMove(pointer({ clientX: 100 + HOLD_TO_MOVE_MAX_TRAVEL_PX })) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('tremble inside the tolerance keeps the hold alive', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { result.current.holdHandlers.onPointerMove(pointer({ clientX: 102, clientY: 101 })) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBe(TASK)
  })

  it('ignores touch pointers (TouchSensor owns the touch long-press)', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer({ pointerType: 'touch' })) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('ignores presses on the card\'s own controls and non-primary buttons', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    const button = document.createElement('button')
    act(() => { result.current.holdHandlers.onPointerDown(pointer({ target: button })) })
    act(() => { result.current.holdHandlers.onPointerDown(pointer({ button: 2 })) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('a hold whose click never arrives stops swallowing after a grace period', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    act(() => { result.current.holdHandlers.onPointerUp() })
    act(() => { vi.advanceTimersByTime(500) })
    // The NEXT genuine click must open the card, not vanish.
    expect(result.current.consumeHoldClick()).toBe(false)
  })

  it('pointercancel drops both the pending hold and the swallow flag', () => {
    const { result } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    act(() => { result.current.holdHandlers.onPointerCancel() })
    expect(result.current.consumeHoldClick()).toBe(false)
  })

  it('unmount clears a pending timer', () => {
    const { result, unmount } = renderHook(() => useCardHoldGesture(TASK))
    act(() => { result.current.holdHandlers.onPointerDown(pointer()) })
    unmount()
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })
})

describe('isHoldRelease (touch entry)', () => {
  const touchStart = () => new Event('touchstart')

  it('a touch drag released in place is a hold', () => {
    expect(isHoldRelease({ delta: { x: 2, y: -3 }, activatorEvent: touchStart() })).toBe(true)
  })

  it('a touch drag that travelled is a drop', () => {
    expect(isHoldRelease({ delta: { x: HOLD_RELEASE_MAX_TRAVEL_PX, y: 0 }, activatorEvent: touchStart() })).toBe(false)
    expect(isHoldRelease({ delta: { x: 0, y: 40 }, activatorEvent: touchStart() })).toBe(false)
  })

  it('mouse and keyboard drags never qualify', () => {
    expect(isHoldRelease({ delta: { x: 0, y: 0 }, activatorEvent: new MouseEvent('mousedown') })).toBe(false)
    expect(isHoldRelease({ delta: { x: 0, y: 0 }, activatorEvent: new KeyboardEvent('keydown') })).toBe(false)
    expect(isHoldRelease({ delta: { x: 0, y: 0 }, activatorEvent: null })).toBe(false)
  })
})

describe('placementIndex / halfFromPoint', () => {
  const order = ['a', 'm', 'b', 'c']

  it('top half inserts before the tapped card, bottom half after it', () => {
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'c', half: 'top' })).toBe(2)
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'c', half: 'bottom' })).toBe(3)
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'a', half: 'top' })).toBe(0)
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'a', half: 'bottom' })).toBe(1)
  })

  it('the index never counts the moved card itself', () => {
    // 'm' sits above 'b' today; "before b" must still be slot 1 of the others.
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'b', half: 'top' })).toBe(1)
  })

  it('end appends, and so does a target that vanished from the column', () => {
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'end' })).toBe(3)
    expect(placementIndex(['a', 'b'], 'm', { columnId: 'x', kind: 'end' })).toBe(2)
    expect(placementIndex(order, 'm', { columnId: 'x', kind: 'card', taskId: 'gone', half: 'top' })).toBe(3)
  })

  it('splits a card at its midpoint', () => {
    const rect = { top: 100, height: 60 }
    expect(halfFromPoint(129, rect)).toBe('top')
    expect(halfFromPoint(130, rect)).toBe('bottom')
    expect(halfFromPoint(159, rect)).toBe('bottom')
  })
})

describe('useHoldToMoveMode (board lifecycle)', () => {
  beforeEach(() => {
    useBoardStore.setState({ movingTaskId: null, tasks: [{ id: TASK, projectId: 'p', columnId: 'c', name: 'x', status: 'todo', priority: 'medium', color: 'purple', labels: [], onTimeline: false, orderIndex: 0 }] as never[] })
    document.body.innerHTML = '<div data-board-columns><div id="inside"></div></div><div id="outside"></div>'
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Escape cancels and stops the key from reaching the board shortcuts', () => {
    const place = vi.fn()
    renderHook(() => useHoldToMoveMode({ place }))
    act(() => { useBoardStore.getState().setMovingTaskId(TASK) })

    const other = vi.fn()
    window.addEventListener('keydown', other)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    window.removeEventListener('keydown', other)

    expect(useBoardStore.getState().movingTaskId).toBeNull()
    expect(other).not.toHaveBeenCalled()
  })

  it('a click off the board cancels; a click on the board surface does not', () => {
    renderHook(() => useHoldToMoveMode({ place: vi.fn() }))
    act(() => { useBoardStore.getState().setMovingTaskId(TASK) })

    act(() => { document.getElementById('inside')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useBoardStore.getState().movingTaskId).toBe(TASK)

    act(() => { document.getElementById('outside')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('the mode does not outlive its card', () => {
    renderHook(() => useHoldToMoveMode({ place: vi.fn() }))
    act(() => { useBoardStore.getState().setMovingTaskId(TASK) })
    act(() => { useBoardStore.getState().removeTask(TASK) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('unmounting the board clears the mode', () => {
    const { unmount } = renderHook(() => useHoldToMoveMode({ place: vi.fn() }))
    act(() => { useBoardStore.getState().setMovingTaskId(TASK) })
    unmount()
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })

  it('exposes the placement callback it was given', () => {
    const place = vi.fn()
    const { result } = renderHook(() => useHoldToMoveMode({ place }))
    result.current.place({ columnId: 'c', kind: 'end' })
    expect(place).toHaveBeenCalledWith({ columnId: 'c', kind: 'end' })
  })
})
