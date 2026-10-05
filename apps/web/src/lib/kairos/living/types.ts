// Shapes shared by the nightly activity scorer, the ranked list and the Health
// panel (research/vorath_0510/living_dominions.md §2 A).

export type ScoredBoard = { id: string; name: string; score: number }
export type ScoredRepo = { slug: string; score: number }

// Stored in dominions.activity by the nightly scorer.
export type DominionActivity = {
  windowDays: number
  scoredAt: string
  boards: ScoredBoard[]
  repos: ScoredRepo[]
  sessions: number
  cardsFinished: number
  notes: number
}

// Recent work that maps to no Dominion: Phase 2 proposal input, shown in Health.
export type UnattributedActivity = {
  scoredAt: string
  boards: ScoredBoard[]
  repos: ScoredRepo[]
}

export const LIVING_UNATTRIBUTED_PREF_KEY = 'kairosLivingUnattributed'
