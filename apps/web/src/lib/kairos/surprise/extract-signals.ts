import type { AlignedCreate, AlignedReinforce, AlignedWriteResult } from '@/lib/data/beliefs'
import type { BeliefV1 } from '@/lib/kairos/beliefs/types'
import { detectAha } from './aha'
import { recordSurprise } from './ledger'
import { recordNightlyOwnerCorrections } from './owner-correction'

// belief_extract persist → surprise signals (spec_surprise Lane 1): nightly
// owner corrections (operator replaces) and ahas, from what the write actually
// applied. Called only when the gate is observe/on (the write result then
// carries ownerCorrections). Best-effort: never throws, never fails the job.

export interface ExtractSignalBatch {
  inputIds: readonly string[]
  questionedIds: readonly string[]
  create: readonly AlignedCreate[]
  reinforce: readonly AlignedReinforce[]
  result: AlignedWriteResult
}

export interface ExtractSignalDeps {
  record?: typeof recordSurprise
  corrections?: typeof recordNightlyOwnerCorrections
}

export async function recordBeliefExtractSurprises(
  userId: string,
  extractKey: string,
  batch: ExtractSignalBatch,
  now: Date = new Date(),
  deps: ExtractSignalDeps = {},
): Promise<void> {
  try {
    const { result } = batch
    if (result.ownerCorrections?.length) {
      await (deps.corrections ?? recordNightlyOwnerCorrections)(userId, extractKey, result.ownerCorrections, now)
    }
    const reinforced = new Set(result.reinforced)
    const superseded = new Set(result.superseded)
    const ahas = detectAha({
      extractKey,
      inputIds: batch.inputIds,
      questionedIds: batch.questionedIds,
      reinforced: batch.reinforce.filter((r) => reinforced.has(r.targetId)),
      // result.created is in create order: created[i] is create[i]'s row.
      replaced: batch.create.flatMap((c, i) => {
        const newId = result.created[i]
        if (!c.supersedes || !newId || !superseded.has(c.supersedes)) return []
        const provenance = (c.values.sourceMetadata.belief as BeliefV1 | undefined)?.provenance ?? []
        return [{ targetId: c.supersedes, newId, provenance }]
      }),
    })
    for (const a of ahas) await (deps.record ?? recordSurprise)(userId, a, { now })
  } catch (err) {
    console.error('[kairos:surprise] belief_extract signals failed:', err)
  }
}
