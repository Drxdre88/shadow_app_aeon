import type { OwnerExtraction } from './extract'
import { ownerStateTtlDays } from './flag'

// Applies the belief_extract side answer (Max-plan answers only — the caller
// skips answeredBy 'api'). Data modules load lazily (handler suites import
// this file's caller without a database).
export async function applyOwnerExtract(userId: string, extraction: OwnerExtraction, now: Date = new Date()): Promise<{ states: number; traits: number }> {
  const { listOwnerProvenance, mutateKairosOwnerModel } = await import('@/lib/data/kairos-owner-model')
  const { mergeOwnerExtraction } = await import('./mutations')
  const ids = [...extraction.states, ...extraction.traits].flatMap((c) => c.provenance)
  const info = await listOwnerProvenance(userId, ids)
  const ttlDays = ownerStateTtlDays()
  return mutateKairosOwnerModel(userId, (model) => {
    const state = mergeOwnerExtraction(model, extraction, info, now, ttlDays)
    return { state, result: { states: extraction.states.length, traits: extraction.traits.length } }
  }, now)
}
