'use client'

import { useSyncExternalStore } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribe(callback: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION)
  mql.addEventListener('change', callback)
  document.addEventListener('visibilitychange', callback)
  return () => {
    mql.removeEventListener('change', callback)
    document.removeEventListener('visibilitychange', callback)
  }
}

function getSnapshot() {
  return (
    document.visibilityState === 'hidden' ||
    window.matchMedia(REDUCED_MOTION).matches
  )
}

// SSR has no document/matchMedia; effects never render server-side anyway.
function getServerSnapshot() {
  return false
}

/**
 * True when ambient effects (theme particle canvases, cursor rAF loops) should
 * be suspended: the user prefers reduced motion, or the tab is backgrounded.
 * Suspending unmounts the active effect, which cancels its requestAnimationFrame
 * loop — those loops otherwise repaint every blurred glass card on every frame.
 */
export function useEffectsSuspended() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
