import { ELO_START, IDEA_SURVIVORS_MAX, type IdeaCritique, type IdeaStatus, type NoveltyResult } from './types'
import type { EloRecord } from './elo'

// Survivor selection for the idea tournament (docs/kairos/35). Elimination
// order (first match wins): repeat → no critique / ungrounded → contradicted →
// already known → borderline but not meaningfully different → bridged but the
// judge said the mapping fails (explicit false only) → no supporting
// evidence. The rest are ranked by Elo (then wins, then key order) and up to
// IDEA_SURVIVORS_MAX survive; past the top one a survivor also needs Elo ≥
// ELO_START, so a losing record never rides in on a thin night.

export type EliminationReason =
  | 'repeat'
  | 'ungrounded'
  | 'contradicted'
  | 'already_known'
  | 'not_different'
  | 'mapping_failed'
  | 'ranked_out'

export interface SelectionInput {
  key: string
  novelty: NoveltyResult
  critique: IdeaCritique | null
  record: EloRecord | null
  // Collision candidate (lane B): critique.mappingHolds === false eliminates.
  bridged?: boolean
}

export interface SelectionResult {
  key: string
  status: IdeaStatus
  eliminatedReason: EliminationReason | null
  // 1-based among the viable (non-eliminated before ranking); null otherwise.
  rank: number | null
}

export function eliminationReason(c: SelectionInput): EliminationReason | null {
  if (c.novelty.class === 'repeat') return 'repeat'
  const cr = c.critique
  if (!cr || cr.verdict === 'ungrounded') return 'ungrounded'
  if (cr.verdict === 'contradicted') return 'contradicted'
  if (cr.alreadyKnown) return 'already_known'
  if (c.novelty.class === 'borderline' && cr.meaningfullyDifferent !== true) return 'not_different'
  if (c.bridged === true && cr.mappingHolds === false) return 'mapping_failed'
  if (cr.supports.length === 0) return 'ungrounded'
  return null
}

const keyOrder = (a: string, b: string) => {
  const na = Number(a.replace(/^\D+/, ''))
  const nb = Number(b.replace(/^\D+/, ''))
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

export function selectSurvivors(inputs: readonly SelectionInput[], max: number = IDEA_SURVIVORS_MAX): SelectionResult[] {
  const out = new Map<string, SelectionResult>()
  const viable: SelectionInput[] = []
  for (const c of inputs) {
    const reason = eliminationReason(c)
    if (reason) out.set(c.key, { key: c.key, status: reason === 'repeat' ? 'repeat' : 'eliminated', eliminatedReason: reason, rank: null })
    else viable.push(c)
  }
  const eloOf = (c: SelectionInput) => c.record?.elo ?? ELO_START
  viable.sort((a, b) =>
    eloOf(b) - eloOf(a) || (b.record?.wins ?? 0) - (a.record?.wins ?? 0) || keyOrder(a.key, b.key))
  let kept = 0
  viable.forEach((c, i) => {
    const rank = i + 1
    const survives = kept < max && (i === 0 || eloOf(c) >= ELO_START)
    if (survives) kept++
    out.set(c.key, { key: c.key, status: survives ? 'survivor' : 'eliminated', eliminatedReason: survives ? null : 'ranked_out', rank })
  })
  return inputs.map((c) => out.get(c.key) as SelectionResult)
}
