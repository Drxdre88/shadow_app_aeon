import type { Scorer, ScoreContext, ScorerResult } from '../types'

export const CHALLENGED_FACTOR = 0.8

export class ChallengedScorer implements Scorer {
  readonly name = 'challenged'

  score(_memory: unknown, ctx: ScoreContext): ScorerResult {
    const open = ctx.openChallenges ?? 0
    return open > 0
      ? { name: this.name, factor: CHALLENGED_FACTOR, note: `${open} open contradiction(s)` }
      : { name: this.name, factor: 1 }
  }
}
