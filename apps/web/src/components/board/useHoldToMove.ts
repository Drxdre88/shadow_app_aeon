'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useBoardStore, useMovingTaskId } from '@/lib/store/boardStore'

// Hold-to-move: press and hold a card to lift it into "move mode", then tap
// where it goes. Two entry gestures feed ONE mode:
//
//   desktop  pointerdown (mouse/pen) held HOLD_TO_MOVE_DELAY_MS with less than
//            HOLD_TO_MOVE_MAX_TRAVEL_PX of travel -> armed. MouseSensor needs
//            5px to start a drag, so a still hold never races it.
//   touch    TouchSensor already lifts the card after its 250ms delay; a
//            release with less than HOLD_RELEASE_MAX_TRAVEL_PX of travel is a
//            hold, not a drop (useBoardDnD -> isHoldRelease) -> armed.
//
// State machine (movingTaskId in boardStore is the single source of truth):
//   idle --hold--> moving(taskId) --tap card / tap column--> place -> idle
//                                 --tap moving card / Esc / tap outside / drag start--> idle
//
// Placement goes through useBoardDnD.commitMove: the same store update,
// server action, undo snapshot and Auto AI arming a drag-drop uses.

export const HOLD_TO_MOVE_DELAY_MS = 450
export const HOLD_TO_MOVE_MAX_TRAVEL_PX = 5
/** A touch drag released within this many px of where it started is a hold. */
export const HOLD_RELEASE_MAX_TRAVEL_PX = 8
/** The click that follows a completed desktop hold is swallowed for this long. */
const HOLD_CLICK_SWALLOW_MS = 300

export type PlacementHalf = 'top' | 'bottom'

export type PlacementTarget =
  | { columnId: string; kind: 'end' }
  | { columnId: string; kind: 'card'; taskId: string; half: PlacementHalf }

/**
 * Insertion index for `reorderWithInsertion` (which removes the moved card
 * first, so the index counts the OTHER cards only): before the tapped card for
 * a top-half tap, after it for a bottom-half tap, or the end of the column.
 * A tapped card that is not in `orderedIds` (filtered away between tap and
 * commit) appends rather than throwing the card to the top.
 */
export function placementIndex(orderedIds: string[], movedId: string, target: PlacementTarget): number {
  const others = orderedIds.filter((id) => id !== movedId)
  if (target.kind === 'end') return others.length
  const at = others.indexOf(target.taskId)
  if (at === -1) return others.length
  return target.half === 'top' ? at : at + 1
}

/** Which half of a card a tap landed in; the exact midpoint counts as bottom. */
export function halfFromPoint(clientY: number, rect: { top: number; height: number }): PlacementHalf {
  return clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
}

/**
 * True when a dnd-kit drag ended where it began on a TOUCH activator: the
 * long-press lifted the card and the finger let go without moving it.
 * Mouse drags never qualify (a 5px twitch is a no-op drop, not a hold).
 */
export function isHoldRelease(event: { delta: { x: number; y: number }; activatorEvent: Event | null }): boolean {
  const activator = event.activatorEvent
  if (!activator || !activator.type.startsWith('touch')) return false
  return Math.hypot(event.delta.x, event.delta.y) < HOLD_RELEASE_MAX_TRAVEL_PX
}

const INTERACTIVE_SELECTOR = 'button, input, textarea, select, a, [role="button"]'
const ESCAPE_OWNER_SELECTOR = '[role="dialog"], input, textarea, select, [contenteditable="true"]'

interface PendingHold {
  x: number
  y: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * Desktop hold detection for one card. Spread `holdHandlers` onto the card's
 * pointer surface; call `consumeHoldClick()` at the top of the click handler
 * and bail when it returns true (that click is the release of the hold, not
 * an open). Touch pointers are ignored here: TouchSensor owns them.
 */
export function useCardHoldGesture(taskId: string, enabled = true) {
  const setMovingTaskId = useBoardStore((s) => s.setMovingTaskId)
  const pendingRef = useRef<PendingHold | null>(null)
  const swallowRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armedRef = useRef(false)

  const clearPending = useCallback(() => {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer)
    pendingRef.current = null
  }, [])

  useEffect(() => () => {
    clearPending()
    if (swallowRef.current) clearTimeout(swallowRef.current)
  }, [clearPending])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled || e.pointerType === 'touch' || e.button !== 0) return
    if ((e.target as Element | null)?.closest(INTERACTIVE_SELECTOR)) return
    clearPending()
    armedRef.current = false
    pendingRef.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        pendingRef.current = null
        armedRef.current = true
        setMovingTaskId(taskId)
      }, HOLD_TO_MOVE_DELAY_MS),
    }
  }, [enabled, taskId, clearPending, setMovingTaskId])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const pending = pendingRef.current
    if (!pending) return
    if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) >= HOLD_TO_MOVE_MAX_TRAVEL_PX) clearPending()
  }, [clearPending])

  // Release: a pending hold is simply a click. A completed hold keeps its
  // "swallow the click" flag alive briefly: the click may never come (the
  // pointer left the card), and it must not eat the NEXT genuine click.
  const onPointerUp = useCallback(() => {
    clearPending()
    if (!armedRef.current) return
    if (swallowRef.current) clearTimeout(swallowRef.current)
    swallowRef.current = setTimeout(() => { armedRef.current = false }, HOLD_CLICK_SWALLOW_MS)
  }, [clearPending])

  const onPointerCancel = useCallback(() => {
    clearPending()
    armedRef.current = false
  }, [clearPending])

  const consumeHoldClick = useCallback(() => {
    const armed = armedRef.current
    armedRef.current = false
    return armed
  }, [])

  const holdHandlers = useMemo(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave: onPointerUp,
  }), [onPointerDown, onPointerMove, onPointerUp, onPointerCancel])

  return { holdHandlers, consumeHoldClick }
}

export interface HoldToMoveActions {
  place: (target: PlacementTarget) => void
  cancel: () => void
}

// Provided by TaskBoard; consumed by cards and columns wherever they render
// (the Zen portal keeps React context, so Zen cards place too).
export const HoldToMoveContext = createContext<HoldToMoveActions | null>(null)

export function useHoldToMoveActions(): HoldToMoveActions | null {
  return useContext(HoldToMoveContext)
}

/** Board-level lifecycle of move mode: Escape / tap-outside cancel, cleanup. */
export function useHoldToMoveMode({ place }: { place: (target: PlacementTarget) => void }): HoldToMoveActions {
  const movingTaskId = useMovingTaskId()
  const setMovingTaskId = useBoardStore((s) => s.setMovingTaskId)
  // The lifted card can vanish under us (deleted by a peer, archived): the
  // mode must not outlive it.
  const movingTaskExists = useBoardStore((s) => (movingTaskId ? s.tasks.some((t) => t.id === movingTaskId) : true))

  const cancel = useCallback(() => setMovingTaskId(null), [setMovingTaskId])

  useEffect(() => {
    if (!movingTaskExists) cancel()
  }, [movingTaskExists, cancel])

  useEffect(() => {
    if (!movingTaskId) return
    // Capture + stopPropagation: Escape ends move mode and nothing else (the
    // board's shortcut handler would otherwise also deselect). An Escape born
    // inside a dialog or a text field belongs to that surface, not to us.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if ((e.target as Element | null)?.closest?.(ESCAPE_OWNER_SELECTOR)) return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    // A tap anywhere off the board surface cancels. Bubble-phase on document
    // runs AFTER React's own handlers, so a placing tap has already landed.
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (target?.closest('[data-board-columns], [data-zen-layer], [data-hold-to-move-banner]')) return
      cancel()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('click', onClick)
    }
  }, [movingTaskId, cancel])

  useEffect(() => () => setMovingTaskId(null), [setMovingTaskId])

  return useMemo(() => ({ place, cancel }), [place, cancel])
}
