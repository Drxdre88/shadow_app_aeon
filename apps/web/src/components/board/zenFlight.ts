import { useZenModeStore, type ZenRect } from '@/lib/store/zenModeStore'

export type { ZenRect }

export interface FlightTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

export const ZEN_MAX_WIDTH = 640
export const ZEN_GUTTER = 12

/** The centered Zen surface rect for a given viewport. */
export function zenTargetRect(viewportWidth: number, viewportHeight: number): ZenRect {
  const availWidth = Math.max(0, viewportWidth - ZEN_GUTTER * 2)
  const availHeight = Math.max(0, viewportHeight - ZEN_GUTTER * 2)
  const width = Math.min(ZEN_MAX_WIDTH, availWidth)
  return {
    left: ZEN_GUTTER + (availWidth - width) / 2,
    top: ZEN_GUTTER,
    width,
    height: availHeight,
  }
}

// The surface is laid out at `target` with transform-origin 0 0; the returned
// pose translates/scales it back onto `source`, so the whole flight is pure
// transform — no width/height animation, no layout work mid-flight.
export function flightTransform(source: ZenRect, target: ZenRect): FlightTransform {
  return {
    x: source.left - target.left,
    y: source.top - target.top,
    scaleX: target.width > 0 && source.width > 0 ? source.width / target.width : 1,
    scaleY: target.height > 0 && source.height > 0 ? source.height / target.height : 1,
  }
}

// getBoundingClientRect reflects any active board pinch scale, which is
// exactly what the flight should launch from / land on: the visual rect.
export function measureColumnRect(columnId: string): ZenRect | null {
  if (typeof document === 'undefined') return null
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(columnId) : columnId.replace(/["\\]/g, '\\$&')
  const el = document.querySelector(`[data-column-id="${escaped}"]`)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** Shared entry point for both the header button and the context menu item. */
export function openZenMode(columnId: string) {
  useZenModeStore.getState().enter(columnId, measureColumnRect(columnId))
}
