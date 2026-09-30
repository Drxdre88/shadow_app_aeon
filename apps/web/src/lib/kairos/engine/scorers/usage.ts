import type { EngineMemory, Scorer, ScorerResult } from '../types'
import { nonNegative } from './metadata'

export const USAGE_STEP = 0.05
export const USAGE_CAP = 6

export class UsageScorer implements Scorer {
  readonly name = 'usage'

  score(memory: EngineMemory): ScorerResult {
    const uses = Math.min(nonNegative(memory.useCount), USAGE_CAP)
    return { name: this.name, factor: 1 + USAGE_STEP * uses }
  }
}
