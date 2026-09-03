'use client'

import { useEffect, useRef } from 'react'
import {
  MAX_BOARD_SCALE,
  SNAP_TO_NORMAL_THRESHOLD,
  layoutCompensation,
  nextScale,
  scrollForFocalPoint,
  touchDistance,
  touchMidpoint,
} from './pinchZoom'
import { publishBoardZoom } from './boardZoom'

interface PinchGesture {
  /** identifiers of the two fingers that opened the pinch */
  idA: number
  idB: number
  startDistance: number
  startScale: number
}

/**
 * Layout inputs the scale write needs. Measured at gesture start and on
 * resize rather than per frame: reading offsetWidth inside touchmove would
 * force a synchronous layout on every move event.
 */
interface BoardMetrics {
  baseWidth: number
  containerHeight: number
}

interface UseBoardPinchZoomOptions {
  /**
   * While this reports true a new pinch is refused (single-finger events are
   * never ours anyway). The board passes "a card is being dragged": a stray
   * second finger during a cross-column drag must not rescale the canvas
   * under the lifted card.
   */
  isLocked?: () => boolean
}

function findTouch(list: TouchList, identifier: number): Touch | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].identifier === identifier) return list[i]
  }
  return null
}

/**
 * Contained pinch-zoom for the board: a two-finger pinch on the scroll
 * container scales the columns wrapper down to a bird's-eye view
 * (MIN_BOARD_SCALE..1) instead of letting the browser zoom the whole page out
 * of the app canvas.
 *
 * Implementation notes (researched against 2026 practice):
 * - Touch events (non-passive) rather than pointer events: once the browser
 *   starts a native pan it fires `pointercancel`, which would kill a pinch
 *   whose second finger lands mid-scroll. `touchstart` with two touches still
 *   fires in that case and `preventDefault()` reliably takes the gesture over.
 * - All per-frame work is imperative style writes (transform + margin + scroll
 *   compensation) on refs — no React state per move, so a 100-card board stays
 *   at gesture framerate. Transform-only scaling; the single margin write per
 *   frame is what keeps the scroll range honest.
 * - Safari's proprietary `gesturestart`/`gesturechange` page zoom is
 *   preventDefault-ed on the container because iOS Safari ignores
 *   `user-scalable=no` in-browser (accessibility override).
 * - No animations are attached to the gesture, so the reduce-motion master
 *   toggle needs no special-casing here.
 * - The wrapper's layout box is re-fitted whenever its unscaled size or the
 *   container's height changes while zoomed (ResizeObserver). The negative
 *   margins are computed from a measured base width; anything that changes
 *   that width mid-zoom — a card leaving a dynamically-sized column during a
 *   drag, a column added, a rotation — would otherwise leave a stale margin,
 *   i.e. dead scroll range next to the shrunken canvas that dnd-kit's
 *   auto-scroll then happily scrolls into.
 * - The settled scale is published (boardZoom.ts) at gesture end and written
 *   per frame to `data-board-zoom` so dnd-kit measuring can read it.
 */
export function useBoardPinchZoom(options: UseBoardPinchZoomOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const scaleRef = useRef(MAX_BOARD_SCALE)
  const gestureRef = useRef<PinchGesture | null>(null)
  const metricsRef = useRef<BoardMetrics>({ baseWidth: 0, containerHeight: 0 })
  const isLockedRef = useRef(options.isLocked)
  useEffect(() => { isLockedRef.current = options.isLocked }, [options.isLocked])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const content = contentRef.current
      if (!content) return
      // offsetWidth ignores transforms and our own negative margins, so this is
      // the columns' true unscaled width.
      metricsRef.current = { baseWidth: content.offsetWidth, containerHeight: container.clientHeight }
    }

    const applyScale = (scale: number, focal: { x: number; y: number } | null) => {
      const content = contentRef.current
      if (!content) return
      const prevScale = scaleRef.current
      scaleRef.current = scale

      if (scale >= MAX_BOARD_SCALE) {
        // Back to pristine: clear inline styles so the board is exactly as
        // React rendered it.
        content.style.transform = ''
        content.style.transformOrigin = ''
        content.style.marginRight = ''
        content.style.marginBottom = ''
        content.style.height = ''
        delete content.dataset.boardZoomed
        delete content.dataset.boardZoom
      } else {
        // Lay the wrapper out at viewport-height / scale so the transform lands
        // it exactly on the container's bottom edge. Without this the columns
        // keep their own height, shrink toward the origin and leave the rest of
        // the screen empty — a postage stamp floating on the canvas rather than
        // a bird's-eye view. Columns stretch into the taller box (globals.css),
        // so zooming out reveals MORE cards instead of merely smaller ones.
        // Grid layout wraps its own rows, so it keeps its natural height.
        const { baseWidth, containerHeight } = metricsRef.current
        const fills = content.dataset.boardLayout !== 'grid' && containerHeight > 0
        const layoutHeight = fills ? containerHeight / scale : content.offsetHeight
        if (fills) content.style.height = `${layoutHeight}px`
        content.dataset.boardZoomed = ''
        content.dataset.boardZoom = String(scale)
        content.style.transform = `scale(${scale})`
        content.style.transformOrigin = '0 0'
        const comp = layoutCompensation(scale, baseWidth || content.offsetWidth, layoutHeight)
        content.style.marginRight = `${comp.marginRight}px`
        content.style.marginBottom = `${comp.marginBottom}px`
      }

      if (focal) {
        const rect = container.getBoundingClientRect()
        container.scrollLeft = scrollForFocalPoint(container.scrollLeft, focal.x - rect.left, prevScale, scale)
        container.scrollTop = scrollForFocalPoint(container.scrollTop, focal.y - rect.top, prevScale, scale)
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return
      const content = contentRef.current
      if (!content) return
      // A third finger joining an active pinch is swallowed, not promoted: the
      // gesture keeps tracking the two fingers that opened it.
      if (gestureRef.current) {
        event.preventDefault()
        return
      }
      // Locked (a card is lifted): leave the touches alone. The container's
      // touch-action already forbids native pinch, and dnd-kit keeps
      // tracking the finger it started with.
      if (isLockedRef.current?.()) return
      // Stop the browser from starting a native pinch-zoom or scroll with
      // these fingers — the board owns multi-finger gestures.
      event.preventDefault()
      // Re-measure per gesture: a column added or the device rotated since the
      // last pinch would otherwise size the board against a stale layout.
      // Safe while already zoomed — neither metric is affected by our own
      // transform, height or margin writes.
      measure()
      const [a, b] = [event.touches[0], event.touches[1]]
      gestureRef.current = {
        idA: a.identifier,
        idB: b.identifier,
        startDistance: touchDistance(a, b),
        startScale: scaleRef.current,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      // While a pinch is live the gesture stays ours no matter how many fingers
      // are down. Bailing out on a third finger would hand the move back to the
      // browser mid-pinch — native page zoom, i.e. exactly the black-void
      // escape this hook exists to prevent.
      event.preventDefault()
      const a = findTouch(event.touches, gesture.idA)
      const b = findTouch(event.touches, gesture.idB)
      // Extra pointers are ignored for the scale math rather than releasing it.
      if (!a || !b) return
      const scale = nextScale(gesture.startScale, gesture.startDistance, touchDistance(a, b))
      applyScale(scale, touchMidpoint(a, b))
    }

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      // Still pinching for as long as both of the gesture's OWN fingers are
      // down — a raw count would keep a dead gesture alive on a stray third.
      if (findTouch(event.touches, gesture.idA) && findTouch(event.touches, gesture.idB)) return
      // Near-1 scales snap back to exactly 1 so the board doesn't sit at a
      // barely-off zoom forever.
      if (scaleRef.current >= SNAP_TO_NORMAL_THRESHOLD) {
        applyScale(MAX_BOARD_SCALE, null)
      }
      gestureRef.current = null
      publishBoardZoom(scaleRef.current)
    }

    // Re-fit the zoomed wrapper to whatever the layout is NOW. Idempotent: the
    // writes are a pure function of (scale, metrics), so a refit that changes
    // nothing writes the same values and the observer goes quiet.
    const refit = () => {
      if (scaleRef.current >= MAX_BOARD_SCALE) return
      const content = contentRef.current
      if (!content) return
      const prev = metricsRef.current
      measure()
      const next = metricsRef.current
      // 1px tolerance on height: clientHeight is integer while the fitted
      // layout height is fractional, so a content-driven container can jitter
      // by a rounding pixel — never worth a re-layout, and it must not loop.
      if (prev.baseWidth === next.baseWidth && Math.abs(prev.containerHeight - next.containerHeight) <= 1) return
      applyScale(scaleRef.current, null)
    }

    // A rotate or window resize while zoomed leaves the board sized against the
    // old viewport — dead space or clipped columns until the next pinch.
    const onResize = () => {
      if (scaleRef.current >= MAX_BOARD_SCALE) return
      measure()
      applyScale(scaleRef.current, null)
    }

    // Border-box sizes ignore transforms, so the observer reports the wrapper's
    // TRUE unscaled width — exactly the input the margin compensation needs.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refit) : null
    if (observer) {
      observer.observe(container)
      if (contentRef.current) observer.observe(contentRef.current)
    }

    // iOS Safari in-browser ignores user-scalable=no; its proprietary gesture
    // events are the only reliable hook to stop page zoom for pinches that
    // begin on the board.
    const onGesture = (event: Event) => event.preventDefault()

    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)
    container.addEventListener('gesturestart', onGesture)
    container.addEventListener('gesturechange', onGesture)
    window.addEventListener('resize', onResize)

    return () => {
      observer?.disconnect()
      publishBoardZoom(MAX_BOARD_SCALE)
      window.removeEventListener('resize', onResize)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
      container.removeEventListener('gesturestart', onGesture)
      container.removeEventListener('gesturechange', onGesture)
    }
  }, [])

  return { containerRef, contentRef }
}
