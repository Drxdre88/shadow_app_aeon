// Card fusion drop geometry + intent state machine. Pure — the DnD hook
// (useFuseIntent.ts) feeds it pointer samples and a clock.
//
// A card hovered by another card is split into thirds: top = "place before",
// bottom = "place after" (the reorder the board has always done), and the
// MIDDLE = fuse. Fusion is never instant: the pointer has to DWELL in the
// middle band for FUSE_DWELL_MS, so a reorder that merely passes through the
// middle never flashes the fuse badge. Once armed the band widens
// (hysteresis) so hand jitter at the boundary doesn't strobe the intent.

export type DropZone = 'before' | 'fuse' | 'after'

export const FUSE_DWELL_MS = 350

/** Fraction of the card's height, [lo, hi), that counts as the fuse band. */
export const FUSE_BAND_ENTER: readonly [number, number] = [1 / 3, 2 / 3]
export const FUSE_BAND_ARMED: readonly [number, number] = [1 / 4, 3 / 4]

export interface ZoneRect {
  top: number
  height: number
}

/**
 * Which band of `rect` the pointer is in. `armed` selects the wider band —
 * pass true only while fusion is already armed on THIS card.
 */
export function dropZoneFromY(clientY: number, rect: ZoneRect, armed = false): DropZone {
  if (!(rect.height > 0)) return clientY < rect.top ? 'before' : 'after'
  const t = (clientY - rect.top) / rect.height
  const [lo, hi] = armed ? FUSE_BAND_ARMED : FUSE_BAND_ENTER
  if (t < lo) return 'before'
  if (t < hi) return 'fuse'
  return 'after'
}

export interface FuseIntent {
  /** The card the pointer is dwelling on, or null when outside every fuse band. */
  targetId: string | null
  /** When the pointer entered this card's fuse band. */
  since: number | null
  armed: boolean
}

export const IDLE_FUSE_INTENT: FuseIntent = { targetId: null, since: null, armed: false }

export interface FuseSample {
  targetId: string | null
  zone: DropZone | null
  now: number
}

/**
 * One step of the intent machine. Leaving the band (or the card) resets;
 * entering a card's band starts its dwell; staying long enough arms it.
 * Armed stays armed while the (widened) band holds the pointer.
 */
export function nextFuseIntent(prev: FuseIntent, sample: FuseSample, dwellMs = FUSE_DWELL_MS): FuseIntent {
  if (sample.targetId === null || sample.zone !== 'fuse') return IDLE_FUSE_INTENT
  if (prev.targetId !== sample.targetId || prev.since === null) {
    return { targetId: sample.targetId, since: sample.now, armed: false }
  }
  return {
    targetId: sample.targetId,
    since: prev.since,
    armed: prev.armed || sample.now - prev.since >= dwellMs,
  }
}

/** ms until an unarmed dwell on a card would arm, or null when not dwelling. */
export function msUntilArmed(intent: FuseIntent, now: number, dwellMs = FUSE_DWELL_MS): number | null {
  if (intent.targetId === null || intent.since === null || intent.armed) return null
  return Math.max(0, intent.since + dwellMs - now)
}
