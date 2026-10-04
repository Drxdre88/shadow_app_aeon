import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import type { KairosPromise } from '@/lib/data/validators/kairos-promises'
import type { SurpriseEvent } from '@/lib/data/validators/kairos-surprise'
import type { ScoreMetrics } from '@/lib/kairos/predictions/score'
import type { IdeaRowLike } from '@/lib/kairos/ideas/stepping/stones'
import type { TrustMode } from './flag'

// Earned trust per area (lane D). Recomputed on every read; never stored and
// never injected into a prompt. Deliberately no cold-read input.

export type TrustLevel = 'unknown' | 'check' | 'second' | 'lean'

export interface TrustGoalLike {
  id: string
  dominionId: string | null
  meta: { state: string; proposedAt: string; decidedAt: string | null; closedAt: string | null }
}

export interface TrustInputs {
  // Closed predictions (right/wrong/void/unresolved); only right/wrong count.
  predictions: readonly KairosPrediction[]
  goals: readonly TrustGoalLike[]
  // Closed promises; only goal-linked ones count.
  promises: readonly KairosPromise[]
  // Display only: never changes a level or statement.
  ideaRows: readonly IdeaRowLike[]
  // Display only: surprise ledger events (owner_correction kept 7 days).
  surpriseEvents: readonly SurpriseEvent[]
  // Active Dominions; areas of other Dominions are left out.
  dominionNames: ReadonlyMap<string, string>
}

export interface TrustScored {
  n: number
  right: number
  // Beta(2,2) posterior mean: (right + 2) / (n + 4).
  reliability: number
  // Wilson 80% lower bound on right / n (0 when n = 0).
  lowerBound: number
}

export interface TrustWentAhead {
  // Settled card_by predictions where Kairos expected the card NOT done.
  n: number
  ownerRight: number
  kairosRight: number
}

export interface TrustArea {
  key: string
  kind: 'dominion' | 'topic'
  label: string
  level: TrustLevel
  statement: string
  scored: TrustScored
  calls: ScoreMetrics | null
  wentAhead: TrustWentAhead
  goals: { taken: number; landed: number; missed: number; vetoed: number }
  promises: { kept: number; missed: number }
  ideas: { accepted: number; dismissed: number }
  corrections7d: number
}

export interface TrustComputed {
  windowDays: number
  minN: number
  areas: TrustArea[]
  corrections7d: number
}

export interface KairosTrustView extends TrustComputed {
  mode: { trust: TrustMode; askFirst: TrustMode }
  generatedAt: string
  // Reads that failed (the view is built from what was read).
  missing: string[]
}
