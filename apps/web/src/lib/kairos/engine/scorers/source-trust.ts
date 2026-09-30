import type { EngineMemory, Scorer, ScorerResult } from '../types'

export const PINNED_FACTOR = 1.25
export const REFLECTION_FACTOR = 1.15
export const PENDING_PROPOSAL_FACTOR = 0.6

export class SourceTrustScorer implements Scorer {
  readonly name = 'source_trust'

  score(memory: EngineMemory): ScorerResult {
    let factor = 1
    const notes: string[] = []
    if (memory.pinned) {
      factor *= PINNED_FACTOR
      notes.push('pinned')
    }
    if (memory.streamClass === 'reflection') {
      factor *= REFLECTION_FACTOR
      notes.push('operator reflection')
    }
    if (memory.sourceMetadata?.status === 'pending') {
      factor *= PENDING_PROPOSAL_FACTOR
      notes.push('pending proposal')
    }
    return notes.length ? { name: this.name, factor, note: notes.join(', ') } : { name: this.name, factor }
  }
}
