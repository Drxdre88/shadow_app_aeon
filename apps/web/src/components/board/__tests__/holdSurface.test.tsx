/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCardHoldGesture, HOLD_TO_MOVE_DELAY_MS } from '../useHoldToMove'
import { useBoardStore } from '@/lib/store/boardStore'

// Regression for the owner's "press and hold does nothing" (0309): dnd-kit
// puts role="button" on the card surface itself, and the hold handler used
// to refuse any press whose target sat inside a [role="button"] — i.e. every
// press on a card. A control INSIDE the surface must still block the hold.

beforeEach(() => {
  vi.useFakeTimers()
  useBoardStore.setState({ movingTaskId: null })
})
afterEach(() => { vi.useRealTimers() })

function press(target: Element, currentTarget: Element) {
  return {
    pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, target, currentTarget,
  } as unknown as React.PointerEvent
}

describe('desktop hold on the card surface', () => {
  it('arms when the press lands on the role="button" surface itself', () => {
    const surface = document.createElement('div')
    surface.setAttribute('role', 'button')
    const text = document.createElement('span')
    surface.appendChild(text)
    const { result } = renderHook(() => useCardHoldGesture('t1'))
    act(() => { result.current.holdHandlers.onPointerDown(press(text, surface)) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBe('t1')
  })

  it('still ignores a press on a real control inside the surface', () => {
    const surface = document.createElement('div')
    surface.setAttribute('role', 'button')
    const btn = document.createElement('button')
    surface.appendChild(btn)
    const { result } = renderHook(() => useCardHoldGesture('t1'))
    act(() => { result.current.holdHandlers.onPointerDown(press(btn, surface)) })
    act(() => { vi.advanceTimersByTime(HOLD_TO_MOVE_DELAY_MS) })
    expect(useBoardStore.getState().movingTaskId).toBeNull()
  })
})
