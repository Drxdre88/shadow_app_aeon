'use client'

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { isDirtyOrGracePeriod } from '@/lib/store/boardStore'

export const POLL_INTERVAL_MS = 30_000
export const RECHECK_MS = 5_000
export const MAX_BACKOFF_MS = 60_000

async function fetchBoardVersion(projectId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/sync/version/${projectId}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.version === 'number' ? data.version : null
  } catch {
    return null
  }
}

/**
 * Keeps an open board in step with the server. knownVersionRef must hold the
 * boardVersion of the data actually on screen (set only when a load is
 * applied); an unknown version always reloads rather than being adopted, so a
 * tab that slept, froze or missed live events can never mistake stale cards
 * for current ones. reload should no-op while a load is already in flight.
 */
export function useBoardFreshness(
  projectId: string,
  knownVersionRef: MutableRefObject<number | null>,
  reload: () => void,
) {
  const inFlightRef = useRef(false)
  const disposedRef = useRef(false)
  const failuresRef = useRef(0)
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkRef = useRef<() => Promise<void>>(async () => {})
  const projectRef = useRef(projectId)

  const scheduleRecheck = useCallback((delayMs: number) => {
    if (disposedRef.current || recheckTimerRef.current) return
    recheckTimerRef.current = setTimeout(() => {
      recheckTimerRef.current = null
      void checkRef.current()
    }, delayMs)
  }, [])

  const recheckSoon = useCallback(() => scheduleRecheck(RECHECK_MS), [scheduleRecheck])

  const checkNow = useCallback(async () => {
    if (disposedRef.current || document.visibilityState !== 'visible') return
    if (isDirtyOrGracePeriod()) {
      recheckSoon()
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const serverVersion = await fetchBoardVersion(projectId)
      if (disposedRef.current || projectRef.current !== projectId) return
      if (serverVersion === null) {
        failuresRef.current += 1
        scheduleRecheck(Math.min(RECHECK_MS * 2 ** (failuresRef.current - 1), MAX_BACKOFF_MS))
        return
      }
      failuresRef.current = 0
      if (knownVersionRef.current === null || serverVersion !== knownVersionRef.current) reload()
    } finally {
      inFlightRef.current = false
    }
  }, [projectId, knownVersionRef, reload, recheckSoon, scheduleRecheck])

  useEffect(() => {
    checkRef.current = checkNow
  }, [checkNow])

  useEffect(() => {
    disposedRef.current = false
    projectRef.current = projectId
    failuresRef.current = 0
    const check = () => void checkNow()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    const interval = setInterval(check, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('resume', check)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('online', check)
    return () => {
      disposedRef.current = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('resume', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('online', check)
      if (recheckTimerRef.current) {
        clearTimeout(recheckTimerRef.current)
        recheckTimerRef.current = null
      }
    }
  }, [checkNow, projectId])

  return { checkNow, recheckSoon }
}
