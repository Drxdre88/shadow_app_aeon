/** @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  getBoardZoom,
  measureUnderBoardZoom,
  publishBoardZoom,
  readBoardScaleFor,
  useBoardZoom,
  verticalStrategyForZoom,
} from '../boardZoom'
import { verticalListSortingStrategy } from '@dnd-kit/sortable'

// The glue between the pinch hook and dnd-kit: where the scale is read from,
// and that the measure / strategy really apply the pure corrections.

afterEach(() => {
  act(() => publishBoardZoom(1))
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('board zoom store', () => {
  it('publishes the settled zoom to subscribers and defaults to 1', () => {
    const { result } = renderHook(() => useBoardZoom())
    expect(result.current).toBe(1)
    act(() => publishBoardZoom(0.5))
    expect(result.current).toBe(0.5)
    expect(getBoardZoom()).toBe(0.5)
  })
})

describe('readBoardScaleFor', () => {
  it('reads the wrapper live data-board-zoom, or 1 outside any wrapper', () => {
    document.body.innerHTML = '<div data-board-scale data-board-zoom="0.4"><div id="card"></div></div><div id="trash"></div>'
    expect(readBoardScaleFor(document.getElementById('card')!)).toBe(0.4)
    expect(readBoardScaleFor(document.getElementById('trash')!)).toBe(1)
  })

  it('treats a missing or unparsable attribute as 1', () => {
    document.body.innerHTML = '<div data-board-scale><div id="a"></div></div><div data-board-scale data-board-zoom="x"><div id="b"></div></div>'
    expect(readBoardScaleFor(document.getElementById('a')!)).toBe(1)
    expect(readBoardScaleFor(document.getElementById('b')!)).toBe(1)
  })
})

describe('measureUnderBoardZoom', () => {
  it('strips the node own sortable translate in viewport px under the wrapper scale', () => {
    act(() => publishBoardZoom(0.5))
    document.body.innerHTML = '<div data-board-scale data-board-zoom="0.5"><div id="card"></div></div>'
    const card = document.getElementById('card')!
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 250, left: 20, width: 80, height: 40, right: 100, bottom: 290 } as DOMRect)
    // jsdom does not resolve transforms to a matrix; feed the serialized form.
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'matrix(1, 0, 0, 1, 0, 100)' } as CSSStyleDeclaration)

    // 100 layout px at scale 0.5 moved the box 50 viewport px.
    expect(measureUnderBoardZoom(card)).toEqual({ top: 200, left: 20, width: 80, height: 40, right: 100, bottom: 240 })
  })

  it('at the normal zoom still strips the own translate (stock dnd-kit) but skips the wrapper lookup', () => {
    document.body.innerHTML = '<div data-board-scale data-board-zoom="1"><div id="card"></div></div>'
    const card = document.getElementById('card')!
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 250, left: 20, width: 80, height: 40, right: 100, bottom: 290 } as DOMRect)
    const styles = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'matrix(1, 0, 0, 1, 0, 100)' } as CSSStyleDeclaration)
    const closest = vi.spyOn(card, 'closest')

    expect(measureUnderBoardZoom(card)).toEqual({ top: 150, left: 20, width: 80, height: 40, right: 100, bottom: 190 })
    expect(styles).toHaveBeenCalledTimes(1)
    expect(closest).not.toHaveBeenCalled()
  })

  it('is a plain bounding rect for an untransformed node', () => {
    act(() => publishBoardZoom(0.5))
    document.body.innerHTML = '<div data-board-scale data-board-zoom="0.5"><div id="col"></div></div>'
    const col = document.getElementById('col')!
    vi.spyOn(col, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 20, width: 100, height: 400, right: 120, bottom: 410 } as DOMRect)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transform: 'none' } as CSSStyleDeclaration)
    expect(measureUnderBoardZoom(col)).toEqual({ top: 10, left: 20, width: 100, height: 400, right: 120, bottom: 410 })
  })
})

describe('verticalStrategyForZoom', () => {
  const args = {
    activeIndex: 0,
    overIndex: 1,
    index: 1,
    rects: [
      { top: 0, left: 0, width: 100, height: 40, right: 100, bottom: 40 },
      { top: 50, left: 0, width: 100, height: 40, right: 100, bottom: 90 },
    ],
    activeNodeRect: null,
  }

  it('is the stock strategy at zoom 1', () => {
    expect(verticalStrategyForZoom(1)).toBe(verticalListSortingStrategy)
  })

  it('divides the stock displacement by the zoom so one card slides one card on screen', () => {
    const stock = verticalListSortingStrategy(args)!
    const zoomed = verticalStrategyForZoom(0.5)(args)!
    expect(stock.y).not.toBe(0)
    expect(zoomed.y).toBeCloseTo(stock.y / 0.5, 8)
    expect(zoomed.x).toBe(stock.x)
  })
})
