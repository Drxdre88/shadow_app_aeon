import type { BoardTask } from '@/lib/store/boardStore'
import type { Rect } from './fusionEffectTiming'

// What the fusion effect needs from the board at the moment the operator
// confirms: where every card IS on screen, in viewport px — the overlay
// lives in a portal on <body>, outside the pinch-scaled columns wrapper, so
// getBoundingClientRect is exactly its coordinate space.

export interface FusionGhost {
  id: string
  name: string
  color: string
  rect: Rect
}

export interface FusionPlay {
  /** Distinguishes consecutive plays; onDone(key) clears only its own. */
  key: number
  survivor: FusionGhost
  sources: FusionGhost[]
}

// jsdom has no CSS.escape — see the 0309 handover. The fallback still keeps
// the id from breaking out of the attribute selector.
const escapeId = (id: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\\]]/g, '')

export function measureCard(id: string): Rect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-task-id="${escapeId(id)}"]`)
  if (!el) return null
  const b = el.getBoundingClientRect()
  if (!(b.width > 0) || !(b.height > 0)) return null
  return { x: b.left, y: b.top, width: b.width, height: b.height }
}

/**
 * null when the survivor cannot be seen — there is nothing to fly into, and
 * the board simply shows the result. A source that is off-screen, filtered
 * out or already gone starts AT the survivor and only contributes its burst.
 */
export function measureFusionPlay(target: BoardTask, sources: readonly BoardTask[], key = Date.now()): FusionPlay | null {
  const survivorRect = measureCard(target.id)
  if (!survivorRect) return null
  return {
    key,
    survivor: { id: target.id, name: target.name, color: target.color, rect: survivorRect },
    sources: sources.map((s) => ({ id: s.id, name: s.name, color: s.color, rect: measureCard(s.id) ?? survivorRect })),
  }
}
