// Pure math for the board's contained pinch-zoom (bird's-eye view).
//
// The board never lets the BROWSER pinch-zoom the page (that escapes the app
// canvas and leaves black void around it). Instead a two-finger pinch on the
// board scroll container drives a clamped `transform: scale()` on the columns
// wrapper. All functions here are pure so the gesture math is unit-testable.

/** Furthest bird's-eye zoom-out. */
export const MIN_BOARD_SCALE = 0.35
/** Normal working scale — the board never magnifies past 1. */
export const MAX_BOARD_SCALE = 1
/** Scales this close to 1 snap back to exactly 1 on gesture end. */
export const SNAP_TO_NORMAL_THRESHOLD = 0.92

export interface TouchPoint {
  clientX: number
  clientY: number
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MAX_BOARD_SCALE
  return Math.min(MAX_BOARD_SCALE, Math.max(MIN_BOARD_SCALE, scale))
}

/** Straight-line distance between two active touches, in CSS px. */
export function touchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
}

/** Midpoint of the two touches — the pinch focal point, in viewport coords. */
export function touchMidpoint(a: TouchPoint, b: TouchPoint): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

/**
 * Scale for the current frame of a pinch: the scale captured at gesture start
 * multiplied by how far the fingers have spread/closed since, clamped to the
 * board's allowed range. A degenerate start distance (fingers on the same
 * point) keeps the starting scale rather than dividing by zero.
 */
export function nextScale(startScale: number, startDistance: number, currentDistance: number): number {
  if (startDistance <= 0 || !Number.isFinite(startDistance)) return clampScale(startScale)
  return clampScale(startScale * (currentDistance / startDistance))
}

/**
 * New scrollLeft/scrollTop that keeps the content point under the pinch focal
 * point stationary on screen while the scale changes from `prevScale` to
 * `newScale`.
 *
 * Derivation: the unscaled content coordinate under the focal point is
 * `(scrollPos + focalOffset) / prevScale`; after rescaling, that coordinate
 * projects to `coord * newScale`, so the scroll position that keeps it under
 * the same focal offset is `coord * newScale - focalOffset`. The browser
 * clamps the value to the valid scroll range on assignment.
 */
export function scrollForFocalPoint(
  scrollPos: number,
  focalOffset: number,
  prevScale: number,
  newScale: number,
): number {
  if (prevScale <= 0) return scrollPos
  const contentCoord = (scrollPos + focalOffset) / prevScale
  return Math.max(0, contentCoord * newScale - focalOffset)
}

/**
 * Negative right/bottom margins that shrink the scaled wrapper's LAYOUT
 * footprint to its VISUAL size. `transform: scale()` alone leaves the layout
 * box at full size, so the scroll container would keep dead scrollable space
 * beyond the shrunken content. Margins are always <= 0 (scale never exceeds 1).
 */
export function layoutCompensation(
  scale: number,
  baseWidth: number,
  baseHeight: number,
): { marginRight: number; marginBottom: number } {
  const s = clampScale(scale)
  // `|| 0` normalizes -0 (scale exactly 1) to plain 0.
  return {
    marginRight: Math.min(0, -(1 - s) * baseWidth) || 0,
    marginBottom: Math.min(0, -(1 - s) * baseHeight) || 0,
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop under a scaled board.
//
// dnd-kit has no notion of a scaled ANCESTOR: it measures every rect with
// getBoundingClientRect (viewport px, already scaled) but treats an element's
// own `transform: translate()` as unscaled px when it strips it back out, and
// the sortable strategies hand back displacements computed from those scaled
// rects that the browser then scales AGAIN inside the wrapper. Both mistakes
// are corrected with the pure helpers below (wired in boardZoom.ts).
// ---------------------------------------------------------------------------

export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

/**
 * The translate part of a computed `transform` (`matrix(...)` /
 * `matrix3d(...)` as browsers serialize it), in the element's own layout px.
 * `none` / anything else → null.
 */
export function parseOwnTranslate(transform: string | null | undefined): { x: number; y: number } | null {
  if (!transform) return null
  if (transform.startsWith('matrix3d(')) {
    const m = transform.slice(9, -1).split(',').map((v) => parseFloat(v))
    if (m.length < 14 || !Number.isFinite(m[12]) || !Number.isFinite(m[13])) return null
    return { x: m[12], y: m[13] }
  }
  if (transform.startsWith('matrix(')) {
    const m = transform.slice(7, -1).split(',').map((v) => parseFloat(v))
    if (m.length < 6 || !Number.isFinite(m[4]) || !Number.isFinite(m[5])) return null
    return { x: m[4], y: m[5] }
  }
  return null
}

/**
 * A viewport rect with the element's OWN translation removed, honouring the
 * ancestor scale: a translate of `t` layout px moves the box `t * scale`
 * viewport px, so that is what must be subtracted. Width/height are already
 * correct — a translation never resizes.
 */
export function rectWithoutOwnTranslate<R extends RectLike>(
  rect: R,
  translate: { x: number; y: number } | null,
  scale: number,
): { top: number; left: number; width: number; height: number; right: number; bottom: number } {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1
  const dx = translate ? translate.x * s : 0
  const dy = translate ? translate.y * s : 0
  const left = rect.left - dx
  const top = rect.top - dy
  return { top, left, width: rect.width, height: rect.height, right: left + rect.width, bottom: top + rect.height }
}

/**
 * Converts a displacement computed in viewport px (what a sortable strategy
 * derives from scaled rects) into the layout px the element must be
 * translated by INSIDE the scaled wrapper to move that far on screen.
 */
export function scaleDisplacement<T extends { x: number; y: number }>(transform: T, scale: number): T {
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1
  if (s === 1) return transform
  return { ...transform, x: transform.x / s, y: transform.y / s }
}
