import type { SurpriseEventInput } from '@/lib/data/validators/kairos-surprise'

// Aha (spec_surprise Lane 1) — pure detection over one belief_extract batch.
// Two shapes count as an insight worth surfacing:
//  - bridge: one NEW input id is provenance for ≥2 distinct beliefs this
//    batch actually reinforced (one remark explaining several held views);
//  - resolve: a replace that actually superseded a belief which was open or
//    flagged for re-examination (a question answered with a new view).
// The event is ledger-only here (s .3); the stage reads ledger ahas through
// the surprise stage source (Lane 3), so nothing is posted directly.

export const AHA_S = 0.3
export const AHA_CAP = 3

export interface AhaBatch {
  extractKey: string
  // The job's new input ids (not remaining evidence).
  inputIds: readonly string[]
  // Reinforcements the write applied (targetId ∈ result.reinforced).
  reinforced: ReadonlyArray<{ targetId: string; provenance: readonly string[] }>
  // Replaces the write applied: target superseded by newId.
  replaced: ReadonlyArray<{ targetId: string; newId: string; provenance: readonly string[] }>
  // Beliefs put to the model as flagged (lost support) or open (surprise).
  questionedIds: readonly string[]
}

export function detectAha(batch: AhaBatch): SurpriseEventInput[] {
  const out: SurpriseEventInput[] = []
  const fresh = new Set(batch.inputIds)
  const byInput = new Map<string, Set<string>>()
  for (const r of batch.reinforced) {
    for (const id of r.provenance) {
      if (!fresh.has(id)) continue
      const set = byInput.get(id) ?? new Set<string>()
      set.add(r.targetId)
      byInput.set(id, set)
    }
  }
  for (const [inputId, targets] of byInput) {
    if (targets.size < 2) continue
    out.push({
      key: `aha:${batch.extractKey}:bridge:${inputId}`,
      kind: 'aha',
      s: AHA_S,
      refs: { beliefIds: [...targets], memoryIds: [inputId] },
    })
  }
  const questioned = new Set(batch.questionedIds)
  for (const r of batch.replaced) {
    if (!questioned.has(r.targetId)) continue
    out.push({
      key: `aha:${batch.extractKey}:resolve:${r.targetId}`,
      kind: 'aha',
      s: AHA_S,
      refs: { beliefIds: [r.targetId, r.newId], memoryIds: [...r.provenance] },
    })
  }
  return out.slice(0, AHA_CAP)
}
