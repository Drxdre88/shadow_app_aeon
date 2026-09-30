import type { Scorer } from '../types'
import { ChallengedScorer } from './challenged'
import { FreshnessScorer } from './freshness'
import { OutcomeScorer } from './outcome'
import { SourceTrustScorer } from './source-trust'
import { SupportScorer } from './support'
import { UsageScorer } from './usage'

export { ChallengedScorer, FreshnessScorer, OutcomeScorer, SourceTrustScorer, SupportScorer, UsageScorer }

export function defaultScorers(): Scorer[] {
  return [
    new SourceTrustScorer(),
    new FreshnessScorer(),
    new UsageScorer(),
    new SupportScorer(),
    new OutcomeScorer(),
    new ChallengedScorer(),
  ]
}
