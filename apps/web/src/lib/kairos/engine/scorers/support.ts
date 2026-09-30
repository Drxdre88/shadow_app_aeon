import type { EngineMemory, Scorer, ScoreContext, ScorerResult } from '../types'
import { nonNegative, readSupport } from './metadata'

export const SUPPORT_STEP = 0.1
export const SUPPORT_CAP = 5

export class SupportScorer implements Scorer {
  readonly name = 'support'

  score(memory: EngineMemory, ctx: ScoreContext): ScorerResult {
    const support = ctx.support ?? readSupport(memory)
    const n = Math.min(nonNegative(support?.independentSupports), SUPPORT_CAP)
    return { name: this.name, factor: 1 + SUPPORT_STEP * n }
  }
}
