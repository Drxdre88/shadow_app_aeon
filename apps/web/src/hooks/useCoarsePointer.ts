'use client'

import { useSyncExternalStore } from 'react'

const COARSE_POINTER = '(pointer: coarse)'

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(COARSE_POINTER)
}

function subscribe(callback: () => void) {
  const mql = query()
  if (!mql || typeof mql.addEventListener !== 'function') return () => {}
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot() {
  return query()?.matches ?? false
}

function getServerSnapshot() {
  return false
}

/**
 * True on a touch-first pointer, where anything revealed by hover is
 * unreachable — such devices never hover, so `group-hover` affordances and
 * right-click menus have to be replaced by an always-visible control.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
