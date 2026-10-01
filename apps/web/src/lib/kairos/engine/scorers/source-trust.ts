import { originKindOf, type OriginKind } from '@/lib/kairos/origin'
import type { EngineMemory, Scorer, ScorerResult } from '../types'

export const PINNED_FACTOR = 1.25
export const PENDING_PROPOSAL_FACTOR = 0.6
// P2.5 (G7): a reflection's boost follows whose words it is (sourceMetadata.
// origin, else inferred), not its stream class. Only the operator's own
// reflection keeps the old ×1.15.
export const REFLECTION_FACTOR_BY_ORIGIN: Record<OriginKind, number> = {
  operator: 1.15,
  activity: 1,
  agent: 1,
  kairos: 0.9,
  external: 0.7,
}
export const REFLECTION_FACTOR = REFLECTION_FACTOR_BY_ORIGIN.operator
// Ingested third-party content is discounted whatever its stream class.
export const EXTERNAL_FACTOR = REFLECTION_FACTOR_BY_ORIGIN.external

export class SourceTrustScorer implements Scorer {
  readonly name = 'source_trust'

  score(memory: EngineMemory): ScorerResult {
    let factor = 1
    const notes: string[] = []
    if (memory.pinned) {
      factor *= PINNED_FACTOR
      notes.push('pinned')
    }
    const origin = originKindOf(memory)
    if (memory.streamClass === 'reflection') {
      const f = REFLECTION_FACTOR_BY_ORIGIN[origin]
      if (f !== 1) {
        factor *= f
        notes.push(origin === 'operator' ? 'operator reflection' : `${origin} reflection`)
      }
    } else if (origin === 'external') {
      factor *= EXTERNAL_FACTOR
      notes.push('external origin')
    }
    if (memory.sourceMetadata?.status === 'pending') {
      factor *= PENDING_PROPOSAL_FACTOR
      notes.push('pending proposal')
    }
    return notes.length ? { name: this.name, factor, note: notes.join(', ') } : { name: this.name, factor }
  }
}
