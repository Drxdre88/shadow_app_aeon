/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBoardHover } from '../useBoardHover'

// Pins the bug behind "a label added in Zen mode lands on a different card":
// the hovered-card tracker must see cards rendered OUTSIDE the board element
// (the Zen portal), not only cards inside it.

function card(id: string, parent: Element) {
  const el = document.createElement('div')
  el.setAttribute('data-task-id', id)
  parent.appendChild(el)
  return el
}

function hover(el: Element) {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
}

afterEach(() => { document.body.innerHTML = '' })

describe('useBoardHover', () => {
  it('tracks a card inside the board', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    const { result } = renderHook(() => useBoardHover())
    ;(result.current.boardRef as React.MutableRefObject<HTMLDivElement | null>).current = board
    const a = card('a', board)
    act(() => hover(a))
    expect(result.current.hoveredTaskId).toBe('a')
  })

  it('tracks a card rendered in a portal outside the board (Zen mode)', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    card('board-card', board)
    const zen = document.createElement('div')
    zen.setAttribute('data-zen-layer', '')
    document.body.appendChild(zen)
    const zenCard = card('zen-card', zen)

    const { result } = renderHook(() => useBoardHover())
    ;(result.current.boardRef as React.MutableRefObject<HTMLDivElement | null>).current = board
    act(() => hover(zenCard))
    expect(result.current.hoveredTaskId).toBe('zen-card')
  })

  it('clears when the pointer moves onto non-card chrome or leaves the window', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    const a = card('a', board)
    const chrome = document.createElement('div')
    document.body.appendChild(chrome)

    const { result } = renderHook(() => useBoardHover())
    act(() => hover(a))
    expect(result.current.hoveredTaskId).toBe('a')
    act(() => hover(chrome))
    expect(result.current.hoveredTaskId).toBeNull()

    act(() => hover(a))
    act(() => { document.documentElement.dispatchEvent(new MouseEvent('mouseleave')) })
    expect(result.current.hoveredTaskId).toBeNull()
  })

  it('stops listening after unmount', () => {
    const board = document.createElement('div')
    document.body.appendChild(board)
    const a = card('a', board)
    const { result, unmount } = renderHook(() => useBoardHover())
    unmount()
    act(() => hover(a))
    expect(result.current.hoveredTaskId).toBeNull()
  })
})
