// ─────────────────────────────────────────────────────────────────────────
// Confidence decay — non-destructive, read-time trust weighting.
//
// A memory's `confidence` is a coarse trust prior stamped at write time from
// its stream class (see CONFIDENCE_BY_STREAM in lib/data/memories.ts). Left
// static, an 8-month-old assumption ranks identically to a belief reaffirmed
// yesterday. Decay fixes that WITHOUT mutating the stored prior or dropping the
// row: we fade confidence toward a floor as a function of time since the belief
// was last reinforced, and fold the result into retrieval ranking as a gentle
// multiplier.
//
// SOTA note (verified 2026-07-09): the 2026 agent-memory field standard is
// EXPONENTIAL (Ebbinghaus forgetting-curve) decay applied as a SOFT ranking
// signal — not a hard filter, and not Weibull. Systems like Zep/Graphiti reserve
// *hard* forgetting for explicit invalidation (which we already model via
// `invalid_at`); decay only re-weights. So this is deliberately a scoring nudge,
// never a gate: a decayed belief is dimmed in ranking but always retrievable.
//
// Reinforcement signal: we decay off `updatedAt`, not `createdAt`. `createdAt`
// already drives the separate 14-day retrieval `recencyDecay`; keying confidence
// off `updatedAt` makes it a genuinely distinct signal — a belief re-captured or
// re-endorsed recently stays trusted even if first written long ago.
// ─────────────────────────────────────────────────────────────────────────

// Belief staleness is slow — months, not the days of retrieval recency. A belief
// untouched for one half-life has its decayable confidence weight halved.
export const CONFIDENCE_HALF_LIFE_DAYS = 90

// Age alone never removes more than (1 - floor) of the prior. Canonical, high-
// trust memory dims but never collapses to noise purely because it is old.
export const CONFIDENCE_DECAY_FLOOR = 0.5

// The stream-prior midpoint. Ranking pivots around this: a mid-confidence memory
// is unaffected, higher is boosted, decayed/lower is dimmed.
export const CONFIDENCE_NEUTRAL = 0.5

// How much confidence is allowed to move ranking vs. semantic relevance. Modest
// on purpose — confidence tunes ties and near-ties; it does not override a strong
// semantic match. Exported so it stays tunable in one place.
export const CONFIDENCE_WEIGHT = 0.6

const DAY_MS = 86_400_000

type ConfidenceInput = {
  confidence: number | null | undefined
  updatedAt?: Date | string | null
  pinned?: boolean | null
}

// Effective (decayed) confidence at read time. Pinned memories and rows with no
// stored prior are exempt — an operator-curated belief never dims, and a missing
// prior falls back to neutral so it contributes nothing to ranking.
export function effectiveConfidence(m: ConfidenceInput, now = Date.now()): number {
  const prior = m.confidence ?? CONFIDENCE_NEUTRAL
  // Pinned memories and rows with no stored prior are exempt from decay: pinned
  // returns its raw prior (so the galaxy still renders it bright), a missing
  // prior returns neutral. Note this is the raw trust value — ranking exemption
  // for pinned lives in confidenceBoost, which returns a true ×1.
  if (m.pinned || m.confidence == null || !m.updatedAt) return prior

  const t = new Date(m.updatedAt).getTime()
  if (!Number.isFinite(t)) return prior // never let a bad date leak NaN into a sort key
  const ageDays = Math.max(0, (now - t) / DAY_MS)
  const survival = Math.exp((-Math.LN2 * ageDays) / CONFIDENCE_HALF_LIFE_DAYS) // 1 → 0
  const factor = CONFIDENCE_DECAY_FLOOR + (1 - CONFIDENCE_DECAY_FLOOR) * survival // floor → 1
  return prior * factor
}

// Multiplier to fold into a composite retrieval score. Pivots around neutral:
// returns 1.0 for a mid-confidence memory, > 1 for high trust, < 1 for decayed
// or low-trust. Bounded to stay a nudge, never a dominant term or a zero.
//
// Pinned memories are a true ×1 (unchanged ranking) — they are operator-curated
// and must not be reordered by a trust prior, especially against a tight pinned
// budget. This is the ranking-side pin exemption; effectiveConfidence keeps the
// raw prior for rendering.
export function confidenceBoost(m: ConfidenceInput, now = Date.now()): number {
  if (m.pinned) return 1
  return 1 + (effectiveConfidence(m, now) - CONFIDENCE_NEUTRAL) * CONFIDENCE_WEIGHT
}
