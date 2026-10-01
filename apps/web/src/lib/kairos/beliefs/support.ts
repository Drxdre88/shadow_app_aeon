import {
  beliefSourceTypeFromProvenance,
  capBeliefConfidence,
  type BeliefSourceType,
  type OriginKind,
} from '@/lib/kairos/origin'
import { remainingProvenance, type BeliefRecheck, type BeliefV1, type LostSourceState } from './types'

// Belief support policy (P2.5, docs/kairos/34 §1.3). Pure: the server, never
// the model, decides a belief's sourceType (from its provenance rows' origins)
// and caps its confidence by it; the re-check cascade penalises a belief whose
// support went away. lib/data runs these under the row lock.

export const RECHECK_PENALTY = 0.7
export const RECHECK_FLOOR = 0.1

// sourceType from the provenance memories that still exist (origins holds only
// rows found). No surviving origin → 'inference'.
export function sourceTypeOf(provenance: readonly string[], origins: ReadonlyMap<string, OriginKind>): BeliefSourceType {
  const kinds: OriginKind[] = []
  for (const id of provenance) {
    const k = origins.get(id)
    if (k) kinds.push(k)
  }
  return beliefSourceTypeFromProvenance(kinds)
}

// An inference-only claim (Kairos's own summaries) never displaces what the
// operator said or an agent/activity recorded: AI summaries of chat count as
// the owner's view only once the owner's own words confirm them.
export function mayReplace(newType: BeliefSourceType, targetType: BeliefSourceType): boolean {
  return newType !== 'inference' || targetType === 'inference'
}

// Reinforce / reaffirm: union the standing provenance with the new support,
// recompute sourceType (an operator-origin reinforcement upgrades it), keep the
// confidence within the new cap, and clear any re-check flag.
export function reinforcedBelief(
  old: BeliefV1,
  added: readonly string[],
  origins: ReadonlyMap<string, OriginKind>,
  modelConfidence?: number,
): BeliefV1 {
  const provenance = [...new Set([...remainingProvenance(old), ...added])]
  const sourceType = sourceTypeOf(provenance, origins)
  const wanted = typeof modelConfidence === 'number' ? Math.max(old.confidence, modelConfidence) : old.confidence
  const next: BeliefV1 = { ...old, provenance, sourceType, confidence: capBeliefConfidence(wanted, sourceType) }
  delete next.recheck
  return next
}

// The support fields an op snapshots (before/after) so revert can restore
// them; recheck null = no flag.
export function supportSnapshot(b: BeliefV1): Record<string, unknown> {
  return { provenance: b.provenance, sourceType: b.sourceType, confidence: b.confidence, recheck: b.recheck ?? null }
}

export function penalisedConfidence(c: number): number {
  if (!Number.isFinite(c)) return RECHECK_FLOOR
  if (c <= RECHECK_FLOOR) return c
  return Math.max(RECHECK_FLOOR, Math.round(c * RECHECK_PENALTY * 1e4) / 1e4)
}

export interface LostSource {
  id: string
  state: LostSourceState
}

export type RecheckDecision =
  | { kind: 'none' }
  // Penalise once per new loss set; record the union of lost sources.
  | { kind: 'flag'; belief: BeliefV1; newlyLost: LostSource[] }
  // Own mind with no provenance left: retire outright.
  | { kind: 'retire'; belief: BeliefV1; newlyLost: LostSource[] }

// `lost` are provenance ids found lost tonight. Sources already recorded (or
// vetoed by an operator revert) are not penalised again — idempotent.
export function decideRecheck(
  belief: BeliefV1,
  lost: readonly LostSource[],
  now: Date,
  opts: { acknowledged?: ReadonlySet<string>; retireVetoed?: boolean } = {},
): RecheckDecision {
  const prov = new Set(belief.provenance)
  const known = new Set((belief.recheck?.lostSources ?? []).map((s) => s.id))
  const seen = new Set<string>()
  const newlyLost = lost.filter((s) => {
    if (!prov.has(s.id) || known.has(s.id) || opts.acknowledged?.has(s.id) || seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
  if (newlyLost.length === 0) return { kind: 'none' }
  const recheck: BeliefRecheck = {
    since: belief.recheck?.since ?? now.toISOString(),
    lostSources: [...(belief.recheck?.lostSources ?? []), ...newlyLost],
  }
  const flagged: BeliefV1 = { ...belief, recheck, confidence: penalisedConfidence(belief.confidence) }
  if (belief.mind === 'own' && !opts.retireVetoed && remainingProvenance(flagged).length === 0) {
    return { kind: 'retire', belief: { ...flagged, confidence: belief.confidence, status: 'retired' }, newlyLost }
  }
  return { kind: 'flag', belief: flagged, newlyLost }
}
