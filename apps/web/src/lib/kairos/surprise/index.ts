// ─────────────────────────────────────────────────────────────────────────
// Kairos surprise — surprise as the engine (spec_surprise). Events land in a
// small per-user ledger (recordSurprise, idempotent by key); beliefs that an
// event questions get an open mark (openMemories) that lets the night engine
// rewrite them. Every behaviour sits behind a flag in ./flag, default off.
//
// Importing this barrel never pulls in the database client: the DB modules
// are imported lazily inside recordSurprise / openMemories / the readers.
// ─────────────────────────────────────────────────────────────────────────

import type { KairosSurpriseLedger } from '@/lib/data/validators/kairos-surprise'
import { emptySurpriseLedger } from './ledger'

export type {
  KairosSurpriseLedger,
  KairosSurpriseView,
  SurpriseEvent,
  SurpriseEventInput,
  SurpriseEventKind,
  SurpriseMark,
  SurpriseSignal,
  SurpriseSignalKind,
} from '@/lib/data/validators/kairos-surprise'
export {
  type SurpriseMode,
  surpriseGateMode,
  surpriseContradictionsOn,
  surpriseCreditMode,
  curiosityLpMode,
  surpriseReplayMode,
  surpriseStageOn,
} from './flag'
export { isOpen, openMemories, openUntilFor, readSurpriseMark } from './marks'
export {
  type ApplySurpriseResult,
  applySurpriseEvent,
  buildSurpriseEvent,
  emptySurpriseLedger,
  pruneSurpriseLedger,
  recordSurprise,
  surpriseEventId,
  surpriseKeySeen,
} from './ledger'

// The ledger, or an empty one on any failure. Never throws.
export async function loadSurpriseLedger(userId: string): Promise<KairosSurpriseLedger> {
  try {
    const { readKairosSurprise } = await import('@/lib/data/kairos-surprise')
    return await readKairosSurprise(userId)
  } catch (err) {
    console.error('[kairos:surprise] loadSurpriseLedger failed:', err)
    return emptySurpriseLedger()
  }
}

// Open memory ids at `now` ([] on failure). Never throws.
export async function loadOpenMemoryIds(
  userId: string,
  now: Date = new Date(),
  opts: { beliefsOnly?: boolean; limit?: number } = {},
): Promise<string[]> {
  try {
    const { listOpenMemoryIds } = await import('@/lib/data/surprise-marks')
    return await listOpenMemoryIds(userId, now, opts)
  } catch (err) {
    console.error('[kairos:surprise] loadOpenMemoryIds failed:', err)
    return []
  }
}
