/** @vitest-environment jsdom */
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { ZenScrollbar } from '../ZenScrollbar'
import { pageScrollTarget } from '../zenScroller'

// The scroller's MATH is covered in zenScroller.test.ts. This file pins the
// WIRING to a live element: a thumb drag has to land on scrollTop, a track tap
// has to page, reduce-motion has to reach the scrollTo behaviour (CSS can't
// gate an explicit `behavior: 'smooth'`), and a second finger must not be able
// to hijack a drag already in progress.

const TRACK_HEIGHT = 400
const CLIENT_HEIGHT = 400
const SCROLL_HEIGHT = 2000
const MAX_SCROLL = SCROLL_HEIGHT - CLIENT_HEIGHT // 1600
// fraction 0.2 -> thumb 80px tall, so 320px of travel.
const THUMB_HEIGHT = 80
const THUMB_TRAVEL = TRACK_HEIGHT - THUMB_HEIGHT

type Metric = HTMLElement & { __ch?: number; __sh?: number; __st?: number }

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  // jsdom has no layout: every box measures 0. Shadow the three metrics the
  // scroller reads with per-element values (the track answers by attribute so
  // it measures correctly from its very first effect).
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: Metric) {
      if (this.__ch !== undefined) return this.__ch
      return this.hasAttribute('data-zen-scrollbar') ? TRACK_HEIGHT : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Metric) {
      return this.__sh ?? 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: Metric) {
      return this.__st ?? 0
    },
    set(this: Metric, v: number) {
      this.__st = v
    },
  })
  scrollTo = vi.fn()
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true)
  // Collapse the scroll-listener's rAF coalescing so re-measures are synchronous.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // Reflect, not `delete`: clientHeight/scrollHeight are readonly in the DOM
  // types, so the delete operator cannot be typed against them.
  for (const prop of ['clientHeight', 'scrollHeight', 'scrollTop', 'scrollTo']) {
    Reflect.deleteProperty(HTMLElement.prototype, prop)
  }
})

function Harness({ reduceMotion = false, scrollHeight = SCROLL_HEIGHT }: { reduceMotion?: boolean; scrollHeight?: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  return (
    <div>
      <div
        data-testid="scroller"
        ref={(el) => {
          if (el) {
            const m = el as Metric
            m.__ch = CLIENT_HEIGHT
            m.__sh = scrollHeight
          }
          ref.current = el
        }}
      />
      <ZenScrollbar
        scrollRef={ref}
        accentColor="rgb(168, 85, 247)"
        glowColor="rgba(168, 85, 247, 0.5)"
        reduceMotion={reduceMotion}
        contentKey={1}
      />
    </div>
  )
}

function pointerEvent(type: string, init: { pointerId: number; clientY: number }): Event {
  // jsdom ships no PointerEvent constructor; React reads pointerId/clientY off
  // the native event, so own properties on a plain Event are equivalent.
  const ev = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(ev, { pointerId: init.pointerId, clientY: init.clientY, clientX: 0, button: 0, isPrimary: true })
  return ev
}

function setup(props: { reduceMotion?: boolean; scrollHeight?: number } = {}) {
  const utils = render(<Harness {...props} />)
  const scroller = utils.getByTestId('scroller') as Metric
  const track = document.querySelector('[data-zen-scrollbar]') as HTMLElement
  const thumb = document.querySelector('[data-zen-scrollbar-thumb]') as HTMLElement
  return { ...utils, scroller, track, thumb }
}

describe('ZenScrollbar geometry', () => {
  it('sizes and shows the thumb from the live scroll metrics', () => {
    const { track, thumb } = setup()
    expect(track.className).toContain('opacity-100')
    expect(thumb.style.height).toBe(`${THUMB_HEIGHT}px`)
    expect(thumb.style.top).toBe('0px')
  })

  it('hides (and stops swallowing taps) when the content fits', () => {
    const { track } = setup({ scrollHeight: CLIENT_HEIGHT })
    expect(track.className).toContain('opacity-0')
    expect(track.className).toContain('pointer-events-none')
  })

  it('follows native scrolling', () => {
    const { scroller, thumb } = setup()
    act(() => {
      scroller.scrollTop = MAX_SCROLL
      fireEvent.scroll(scroller)
    })
    expect(thumb.style.top).toBe(`${THUMB_TRAVEL}px`)
  })
})

describe('ZenScrollbar thumb drag', () => {
  it('maps thumb travel onto scrollTop', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: 180 }))

    // Thumb moved 80 of its 320px travel -> a quarter of the 1600px range.
    expect(scroller.scrollTop).toBe((80 / THUMB_TRAVEL) * MAX_SCROLL)
  })

  it('clamps at the ends instead of overscrolling', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 0 }))
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: 5000 }))
    expect(scroller.scrollTop).toBe(MAX_SCROLL)
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: -5000 }))
    expect(scroller.scrollTop).toBe(0)
  })

  it('ignores moves once the drag has ended', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointerup', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: 400 }))
    expect(scroller.scrollTop).toBe(0)
  })

  // On touch, a second finger landing on the thumb used to overwrite the drag
  // origin — the list then jumped to wherever the newcomer was.
  it('a second pointer cannot hijack an in-progress drag', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 2, clientY: 320 }))

    // The interloper's own moves are inert…
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 2, clientY: 380 }))
    expect(scroller.scrollTop).toBe(0)

    // …and the original pointer still measures from ITS origin (y=100), not
    // from the second finger's.
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: 180 }))
    expect(scroller.scrollTop).toBe((80 / THUMB_TRAVEL) * MAX_SCROLL)
  })

  it('the interloper lifting does not end the owner\'s drag', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 2, clientY: 320 }))
    fireEvent(thumb, pointerEvent('pointerup', { pointerId: 2, clientY: 320 }))

    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 1, clientY: 180 }))
    expect(scroller.scrollTop).toBe((80 / THUMB_TRAVEL) * MAX_SCROLL)
  })

  it('a cancelled drag releases ownership so the next pointer can take over', () => {
    const { scroller, thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    fireEvent(thumb, pointerEvent('pointercancel', { pointerId: 1, clientY: 100 }))

    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 2, clientY: 0 }))
    fireEvent(thumb, pointerEvent('pointermove', { pointerId: 2, clientY: THUMB_TRAVEL }))
    expect(scroller.scrollTop).toBe(MAX_SCROLL)
  })
})

describe('ZenScrollbar track paging', () => {
  it('a tap below the thumb pages down', () => {
    const { track } = setup()
    fireEvent(track, pointerEvent('pointerdown', { pointerId: 1, clientY: 200 }))
    expect(scrollTo).toHaveBeenCalledWith({
      top: pageScrollTarget(0, CLIENT_HEIGHT, SCROLL_HEIGHT, 1),
      behavior: 'smooth',
    })
  })

  it('a tap above the thumb pages up', () => {
    const { scroller, track } = setup()
    act(() => {
      scroller.scrollTop = MAX_SCROLL
      fireEvent.scroll(scroller)
    })
    // Thumb now sits at 320; tap at 100 is above it.
    fireEvent(track, pointerEvent('pointerdown', { pointerId: 1, clientY: 100 }))
    expect(scrollTo).toHaveBeenCalledWith({
      top: pageScrollTarget(MAX_SCROLL, CLIENT_HEIGHT, SCROLL_HEIGHT, -1),
      behavior: 'smooth',
    })
  })

  // An explicit `behavior: 'smooth'` bypasses the global reduce-motion CSS
  // kill-switch, so the master toggle has to be honoured right here.
  it('reduce-motion pages instantly', () => {
    const { track } = setup({ reduceMotion: true })
    fireEvent(track, pointerEvent('pointerdown', { pointerId: 1, clientY: 200 }))
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'auto' })
  })

  it('a press that starts on the thumb does not also page the track', () => {
    const { thumb } = setup()
    fireEvent(thumb, pointerEvent('pointerdown', { pointerId: 1, clientY: 40 }))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
