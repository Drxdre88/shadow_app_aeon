// ─────────────────────────────────────────────────────────────────────────
// Idea tournament — shared contract (P3 Creativity, docs/kairos/35).
// Parent-owned: lanes implement against these types and must not change them.
//
// Night flow:
//   idea_generate job (after aether) → model picks 4–6 directions, writes
//     8–16 candidates citing evidence ids → server grounds citations, embeds,
//     runs the novelty gate (repeat / borderline / novel), retrieves evidence
//     per candidate, and plans the idea_judge job in the same apply.
//   idea_judge job → a skeptical reviewer (different system prompt) critiques
//     each candidate against its evidence (supports / contradicts / already
//     known) and votes on server-scheduled pairwise matches, each asked in
//     both orders; may refine its top two. Server computes Elo, drops
//     ungrounded / contradicted / already-known / repeat candidates, keeps up
//     to IDEA_SURVIVORS_MAX survivors, writes them as inbox proposals
//     (kind 'idea'), and archives every candidate for future novelty checks.
// Survivors are Kairos-origin: they need outside evidence (BackUp anchor,
// P2.5) before they can ever reach the own mind; never straight to a belief.
// ─────────────────────────────────────────────────────────────────────────

export const IDEA_GENERATE_KIND = 'idea_generate' as const
export const IDEA_JUDGE_KIND = 'idea_judge' as const

// Proposal kind (sourceMetadata.kind) of a surviving idea in the inbox.
export const IDEA_PROPOSAL_KIND = 'idea' as const
// Memory type of an archived non-surviving candidate (archived on write,
// streamClass 'trace' so it never grounds retrieval or gets scored).
export const IDEA_CANDIDATE_TYPE = 'idea_candidate' as const

export const IDEA_SURVIVORS_MAX = 3
export const IDEA_DIRECTIONS_MIN = 4
export const IDEA_DIRECTIONS_MAX = 6
export const IDEA_CANDIDATES_MIN = 8
export const IDEA_CANDIDATES_MAX = 16

// Novelty gate: max cosine to the idea archive, pending proposals and held
// beliefs. ≥ REPEAT → dropped as a repeat; [BORDERLINE, REPEAT) → the judge
// is asked "meaningfully different?"; below → novel.
export const NOVELTY_REPEAT_COSINE = 0.88
export const NOVELTY_BORDERLINE_COSINE = 0.8

export const ELO_START = 1000
export const ELO_K = 32
// Pairwise matches per candidate (each match is judged in both orders).
export const MATCHES_PER_CANDIDATE = 3

// Weekly diversity alarm: mean pairwise cosine DISTANCE of the week's
// survivors below this → collapse warning in the weekly review / daily message.
export const DIVERSITY_ALARM_DISTANCE = 0.15

export type NoveltyClass = 'novel' | 'borderline' | 'repeat'
export type CritiqueVerdict = 'grounded' | 'ungrounded' | 'contradicted'
export type IdeaStatus = 'survivor' | 'eliminated' | 'repeat'
export type IdeaOutcome = 'accepted' | 'dismissed'
// No owner decision within the expiry window: archived, never deleted (lib/data/idea-expiry.ts).
export const IDEA_EXPIRED_OUTCOME = 'ignored' as const

// Kinds of move a generator direction takes (re-exported by generate-prompt).
export const IDEA_MOVES = ['stop', 'start', 'combine', 'test', 'simplify'] as const
export type IdeaMove = (typeof IDEA_MOVES)[number]

// Wave 3 atlas axes (lane A): what kind of idea, and how far it leaps.
export const IDEA_KINDS = ['question', 'experiment', 'reframe', 'make', 'ritual'] as const
export type IdeaKind = (typeof IDEA_KINDS)[number]
export const IDEA_LEAPS = ['near', 'far'] as const
export type IdeaLeap = (typeof IDEA_LEAPS)[number]

// Wave 3 optional fields below are set only when their lane's flag is on;
// absent keys keep flag-off JSON byte-identical.

// Atlas cell an idea was filed under (lane A).
export interface IdeaAtlasMeta {
  cell: string
  area: string
  kind: IdeaKind
  leap: IdeaLeap
  leapClaimed: IdeaLeap | null
  took: 'filled' | 'replaced' | null
}

// A verified collision between two far-apart memories (lane B).
export interface IdeaBridgeMeta {
  v: 1
  pairKey: string
  aId: string
  bId: string
  aArea: string | null
  bArea: string | null
  cos: number
  relations: Array<{ a: string; b: string }>
  map: Array<{ a: string; b: string }>
  insight: string
  mappingHolds: boolean | null
  linkedAt?: string
}

// One generated candidate (model output after server grounding).
export interface IdeaCandidate {
  // Stable within a tournament: c1..cN, assigned by the server.
  key: string
  direction: string
  title: string
  // The idea in one or two sentences.
  claim: string
  // Why it might matter to the operator.
  why: string
  // One concrete, small next step that would test it.
  nextStep: string
  // Grounded evidence ids the generator cited (subset of the job's validMemoryIds).
  citedIds: string[]
  kind?: IdeaKind
  leap?: IdeaLeap
  // Collision pair id ("p1") the candidate blends (lane B).
  blend?: string
  // Model-stated typicality 0..1 and lens tag (lane C).
  likelihood?: number
  lens?: string | null
  move?: IdeaMove
}

export interface NoveltyResult {
  class: NoveltyClass
  maxCosine: number
  // The most similar archived idea / proposal / belief, if any.
  nearestId: string | null
  nearestKind: 'idea' | 'proposal' | 'belief' | null
}

export interface IdeaCritique {
  verdict: CritiqueVerdict
  supports: string[]
  contradicts: string[]
  // "Did existing memory already say this?" (Nemori-style surprise check).
  alreadyKnown: boolean
  // Only asked for borderline-novelty candidates; null otherwise.
  meaningfullyDifferent: boolean | null
  note: string
  // Only asked for bridged (collision) candidates (lane B).
  mappingHolds?: boolean | null
}

// sourceMetadata.idea on every archived candidate and surviving proposal.
export interface IdeaMeta {
  v: 1
  tournamentDate: string // YYYY-MM-DD (UTC night of the tournament)
  generateJobId: string
  judgeJobId: string | null
  key: string
  direction: string
  claim: string
  why: string
  nextStep: string
  status: IdeaStatus
  // Why it was eliminated (repeat / ungrounded / contradicted / already_known /
  // not_different / ranked_out); null for survivors.
  eliminatedReason: string | null
  elo: number | null
  rank: number | null
  novelty: NoveltyResult
  critique: IdeaCritique | null
  // The judge's refinement replaced the generator's wording (mutation).
  refined: boolean
  // One line: why it survived (survivors) — shown in the inbox and daily message.
  survivedBecause: string | null
  outcome: IdeaOutcome | typeof IDEA_EXPIRED_OUTCOME | null
  outcomeAt: string | null
  atlas?: IdeaAtlasMeta
  bridge?: IdeaBridgeMeta
  move?: IdeaMove
  round?: 'novelty'
  pick?: 'taste' | 'surprise'
  outcomeBy?: 'operator' | 'agent'
}
