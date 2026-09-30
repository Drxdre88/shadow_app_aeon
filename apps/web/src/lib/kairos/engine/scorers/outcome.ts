import type { EngineMemory, Scorer, ScoreContext, ScorerResult } from '../types'
import { nonNegative, readOutcome } from './metadata'

export const OUTCOME_POSITIVE_STEP = 0.15
export const OUTCOME_NEGATIVE_STEP = 0.2
export const OUTCOME_FLOOR = 0.5

export class OutcomeScorer implements Scorer {
  readonly name = 'outcome'

  score(memory: EngineMemory, ctx: ScoreContext): ScorerResult {
    const outcome = ctx.outcome ?? readOutcome(memory)
    const raw = 1 + OUTCOME_POSITIVE_STEP * nonNegative(outcome?.positive) - OUTCOME_NEGATIVE_STEP * nonNegative(outcome?.negative)
    return { name: this.name, factor: Math.max(OUTCOME_FLOOR, raw) }
  }
}
