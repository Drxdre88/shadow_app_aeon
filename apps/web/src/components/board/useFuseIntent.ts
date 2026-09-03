'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useBoardStore } from '@/lib/store/boardStore'
import { readCardRects } from './dropIndex'
import {
  IDLE_FUSE_INTENT,
  dropZoneFromY,
  msUntilArmed,
  nextFuseIntent,
  type FuseIntent,
  type ZoneRect,
} from './fuseZone'

/**
 * The card VISUALLY under the pointer in a column — its on-screen rect,
 * sortable displacement included, exactly what resolveDropIndex measures for
 * the reorder. Fusion targets what the eye sees, not dnd-kit's `over` (which
 * is the layout slot and sits one card off while neighbours are displaced).
 * Viewport px on both sides, so pinch-zoom needs no correction. The dragged
 * card itself is skipped. null = nothing under the pointer.
 */
export function findCardAtY(columnId: string, excludeTaskId: string, pointerY: number): (ZoneRect & { id: string }) | null {
  const rects = readCardRects(columnId, excludeTaskId)
  if (!rects) return null
  for (const rect of rects) {
    if (pointerY >= rect.top && pointerY < rect.top + rect.height) return rect
  }
  return null
}

export interface FuseSampleInput {
  /** The card under the pointer, or null (a column, the trash, nothing). */
  targetId: string | null
  pointerY: number | null
  rect: ZoneRect | null
}

/**
 * Drives the fuse intent machine (fuseZone.ts) from drag samples and
 * publishes the ARMED target to the board store, where the target card and
 * the drag preview read it. A dwell timer covers the case where the pointer
 * holds perfectly still: no move event arrives, yet the dwell must elapse.
 */
export function useFuseIntent() {
  const intentRef = useRef<FuseIntent>(IDLE_FUSE_INTENT)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publish = useCallback((intent: FuseIntent) => {
    const armedId = intent.armed ? intent.targetId : null
    const { fuseTargetId, setFuseTargetId } = useBoardStore.getState()
    if (fuseTargetId !== armedId) setFuseTargetId(armedId)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const clear = useCallback(() => {
    stopTimer()
    intentRef.current = IDLE_FUSE_INTENT
    publish(IDLE_FUSE_INTENT)
  }, [stopTimer, publish])

  const observe = useCallback((sample: FuseSampleInput): FuseIntent => {
    const prev = intentRef.current
    const stillOnTarget = prev.targetId !== null && prev.targetId === sample.targetId
    const zone = sample.targetId !== null && sample.rect && sample.pointerY !== null
      ? dropZoneFromY(sample.pointerY, sample.rect, prev.armed && stillOnTarget)
      : null
    const now = Date.now()
    const next = nextFuseIntent(prev, { targetId: sample.targetId, zone, now })
    intentRef.current = next

    const wait = msUntilArmed(next, now)
    if (wait === null) {
      stopTimer()
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const current = intentRef.current
        if (current.targetId === null) return
        const armed = nextFuseIntent(current, { targetId: current.targetId, zone: 'fuse', now: Date.now() })
        intentRef.current = armed
        publish(armed)
      }, wait)
    }

    publish(next)
    return next
  }, [stopTimer, publish])

  /** The card fusion is armed on right now, or null. Read at drop time. */
  const armedTargetId = useCallback(() => {
    const intent = intentRef.current
    return intent.armed ? intent.targetId : null
  }, [])

  useEffect(() => () => {
    stopTimer()
    useBoardStore.getState().setFuseTargetId(null)
  }, [stopTimer])

  return useMemo(() => ({ observe, clear, armedTargetId }), [observe, clear, armedTargetId])
}
