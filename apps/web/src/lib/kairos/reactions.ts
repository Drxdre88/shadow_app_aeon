import { writeOutcomeReaction, writeUseReaction, type OutcomeKind } from '@/lib/data/memory-reactions'
import { rescoreMemories } from './rescore'

export type { OutcomeKind }

// Operator reactions (docs/kairos/32 §2, docs/kairos/34 §6) — the business
// orchestration over the pure lib/data/memory-reactions writes: write the
// reaction + its 'feedback' op (one transaction), then rescore exactly the
// touched rows (best-effort, own transaction). Never throws: a reaction must
// never fail the caller's accept / dismiss / answer / cite / expire.

export async function reactOutcome(
  userId: string,
  memoryId: string,
  kind: OutcomeKind,
  reason: string,
): Promise<void> {
  try {
    const touched = await writeOutcomeReaction(userId, memoryId, kind, reason)
    if (touched) await rescoreMemories(userId, [memoryId], reason)
  } catch (err) {
    console.warn('[kairos-reactions] outcome reaction failed', {
      memoryId,
      kind,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function reactUsed(
  userId: string,
  ids: readonly string[],
  reason: string,
  at: Date = new Date(),
): Promise<void> {
  try {
    const touchedIds = await writeUseReaction(userId, ids, reason, at)
    if (touchedIds.length > 0) await rescoreMemories(userId, touchedIds, reason)
  } catch (err) {
    console.warn('[kairos-reactions] use reaction failed', {
      count: ids.length,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
