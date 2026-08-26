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

interface PinchGesture {
  startDistance: number
  startScale: number
  baseWidth: number
  baseHeight: number
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
 */
export function useBoardPinchZoom() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const scaleRef = useRef(MAX_BOARD_SCALE)
  const gestureRef = useRef<PinchGesture | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const applyScale = (scale: number, focal: { x: number; y: number } | null, gesture: PinchGesture) => {
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
      } else {
        content.style.transform = `scale(${scale})`
        content.style.transformOrigin = '0 0'
        const comp = layoutCompensation(scale, gesture.baseWidth, gesture.baseHeight)
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
      if (event.touches.length !== 2) return
      const content = contentRef.current
      if (!content) return
      // Stop the browser from starting a native pinch-zoom or scroll with
      // these two fingers — the board owns two-finger gestures.
      event.preventDefault()
      gestureRef.current = {
        startDistance: touchDistance(event.touches[0], event.touches[1]),
        startScale: scaleRef.current,
        // offsetWidth/Height ignore transforms — this is the unscaled layout
        // size the negative-margin compensation is computed against.
        baseWidth: content.offsetWidth,
        baseHeight: content.offsetHeight,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture || event.touches.length !== 2) return
      event.preventDefault()
      const scale = nextScale(
        gesture.startScale,
        gesture.startDistance,
        touchDistance(event.touches[0], event.touches[1]),
      )
      applyScale(scale, touchMidpoint(event.touches[0], event.touches[1]), gesture)
    }

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture || event.touches.length >= 2) return
      // Near-1 scales snap back to exactly 1 so the board doesn't sit at a
      // barely-off zoom forever.
      if (scaleRef.current >= SNAP_TO_NORMAL_THRESHOLD) {
        applyScale(MAX_BOARD_SCALE, null, gesture)
      }
      gestureRef.current = null
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

    return () => {
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
