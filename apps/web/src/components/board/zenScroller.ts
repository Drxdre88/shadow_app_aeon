export const MIN_THUMB_HEIGHT = 36
export const PAGE_FRACTION = 0.9

export interface ThumbGeometry {
  visible: boolean
  thumbHeight: number
  thumbTop: number
}

/** Thumb size + position for the Zen scroller, from live scroll metrics. */
export function thumbGeometry(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  minThumb: number = MIN_THUMB_HEIGHT
): ThumbGeometry {
  const maxScroll = scrollHeight - clientHeight
  if (trackHeight <= 0 || clientHeight <= 0 || maxScroll <= 0) {
    return { visible: false, thumbHeight: Math.max(0, trackHeight), thumbTop: 0 }
  }
  const fraction = clientHeight / scrollHeight
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(Math.min(minThumb, trackHeight), trackHeight * fraction)
  )
  const maxThumbTop = trackHeight - thumbHeight
  const progress = Math.min(1, Math.max(0, scrollTop / maxScroll))
  return { visible: true, thumbHeight, thumbTop: progress * maxThumbTop }
}

/** Inverse mapping: where the list must scroll so the thumb sits at thumbTop. */
export function scrollTopForThumbTop(
  thumbTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  thumbHeight: number
): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  const maxThumbTop = trackHeight - thumbHeight
  if (maxThumbTop <= 0) return 0
  const progress = Math.min(1, Math.max(0, thumbTop / maxThumbTop))
  return progress * maxScroll
}

/** Tap-on-track paging: scroll almost a full viewport toward the tap. */
export function pageScrollTarget(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  direction: 1 | -1
): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight)
  return Math.min(maxScroll, Math.max(0, scrollTop + direction * clientHeight * PAGE_FRACTION))
}
