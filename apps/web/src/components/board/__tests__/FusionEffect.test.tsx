/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { FusionEffect, burstSize } from '../FusionEffect'
import { arrivalTime, totalDuration } from '../fusionEffectTiming'
import { useThemeStore } from '@/stores/themeStore'
import type { FusionPlay } from '../fusionMeasure'

// The overlay: one ghost per absorbed card flying from its own rect, a halo
// on the survivor, a progress pill for chains, done exactly once when the
// choreography ends — and nothing at all when Smooth UI Renders is off.

const play: FusionPlay = {
  key: 42,
  survivor: { id: 's', name: 'Survivor', color: 'cyan', rect: { x: 600, y: 300, width: 220, height: 120 } },
  sources: [
    { id: 'a', name: 'Alpha', color: 'pink', rect: { x: 40, y: 60, width: 200, height: 100 } },
    { id: 'b', name: 'Beta', color: 'purple', rect: { x: 40, y: 260, width: 200, height: 100 } },
  ],
}

let frameCallbacks: FrameRequestCallback[] = []
let now = 0
function flushFrames(ms: number, step = 16) {
  const end = now + ms
  while (now < end && frameCallbacks.length) {
    now = Math.min(end, now + step)
    const batch = frameCallbacks
    frameCallbacks = []
    for (const cb of batch) cb(now)
  }
}

beforeEach(() => {
  now = 0
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frameCallbacks.push(cb); return frameCallbacks.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  useThemeStore.setState({ smoothUiRenders: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ghosts = () => Array.from(document.querySelectorAll('[data-fusion-ghost]')) as HTMLElement[]

describe('FusionEffect', () => {
  it('renders nothing and finishes at once when Smooth UI Renders is off', () => {
    useThemeStore.setState({ smoothUiRenders: false })
    const onDone = vi.fn()
    render(<FusionEffect play={play} onDone={onDone} />)
    expect(document.querySelector('[data-fusion-effect]')).toBeNull()
    expect(onDone).toHaveBeenCalledWith(42)
  })

  it('renders nothing without a play', () => {
    render(<FusionEffect play={null} onDone={vi.fn()} />)
    expect(document.querySelector('[data-fusion-effect]')).toBeNull()
  })

  it('flies one ghost per source from its own card into the survivor, holds while the server is still landing steps, then reports done once', () => {
    const onDone = vi.fn()
    const { rerender } = render(<FusionEffect play={play} progress={{ done: 0, total: 2 }} onDone={onDone} />)
    const overlay = document.querySelector('[data-fusion-effect]') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.className).toContain('pointer-events-none')
    expect(ghosts()).toHaveLength(2)
    expect(ghosts()[0].textContent).toContain('Alpha')
    expect(ghosts()[0].style.transform).toContain('translate(40px, 60px)')
    expect(document.querySelector('[data-fusion-halo]')).toBeTruthy()
    expect(document.querySelector('[data-fusion-progress]')?.textContent).toContain('Fusing 1 of 2')

    // Mid-flight: the first ghost has moved and shrunk, the second waits on its card.
    act(() => flushFrames(200))
    const [g0] = ghosts()
    expect(g0.style.visibility).toBe('visible')
    expect(g0.style.transform).not.toContain('translate(40px, 60px)')
    expect(g0.style.transform).toMatch(/scale\(0\.[0-9]+\)/)

    // After every arrival the ghosts are hidden inside the survivor.
    act(() => flushFrames(arrivalTime(1, 2) - 200 + 16))
    expect(ghosts().every((g) => g.style.visibility === 'hidden')).toBe(true)
    expect(onDone).not.toHaveBeenCalled()

    // The choreography is over but a chain is still landing: the scene holds
    // (halo breathing, pill up) instead of going dark before the toast.
    act(() => flushFrames(totalDuration(2)))
    expect(onDone).not.toHaveBeenCalled()
    expect(document.querySelector('[data-fusion-progress]')).toBeTruthy()

    rerender(<FusionEffect play={play} progress={null} onDone={onDone} />)
    act(() => flushFrames(40))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith(42)
    expect(frameCallbacks).toHaveLength(0)
  })

  it('finishes on schedule when there is no chain to wait for', () => {
    const onDone = vi.fn()
    render(<FusionEffect play={play} onDone={onDone} />)
    act(() => flushFrames(totalDuration(2) - 40))
    expect(onDone).not.toHaveBeenCalled()
    act(() => flushFrames(80))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('aims at where the survivor IS each frame, not where it was at confirm', () => {
    if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (v: string) => v }
    const survivorEl = document.createElement('div')
    survivorEl.setAttribute('data-task-id', 's')
    let top = 300
    survivorEl.getBoundingClientRect = () => ({ left: 600, top, width: 220, height: 120, x: 600, y: top, right: 820, bottom: top + 120, toJSON: () => ({}) })
    document.body.appendChild(survivorEl)
    try {
      render(<FusionEffect play={play} onDone={vi.fn()} />)
      act(() => flushFrames(100))
      const halo = document.querySelector('[data-fusion-halo]') as HTMLElement
      expect(halo.style.top).toBe('300px')
      // The column reflowed under the play: the survivor moved up a card.
      top = 180
      act(() => flushFrames(100))
      expect(halo.style.top).toBe('180px')
      act(() => flushFrames(totalDuration(2)))
      // Every ghost ended inside the moved survivor, hidden.
      expect(ghosts().every((g) => g.style.visibility === 'hidden')).toBe(true)
    } finally {
      survivorEl.remove()
    }
  })

  it('shrinks each burst as the swarm grows so the particle pool stays bounded', () => {
    expect(burstSize(1)).toBe(42)
    expect(burstSize(4)).toBe(21)
    expect(burstSize(100)).toBe(8)
    expect(burstSize(0)).toBe(42)
  })

  it('a new play with a new key restarts the scene', () => {
    const onDone = vi.fn()
    const { rerender } = render(<FusionEffect play={play} onDone={onDone} />)
    act(() => flushFrames(300))
    rerender(<FusionEffect play={{ ...play, key: 43, sources: [play.sources[0]] }} onDone={onDone} />)
    expect(ghosts()).toHaveLength(1)
    expect(ghosts()[0].style.transform).toContain('translate(40px, 60px)')
  })
})
