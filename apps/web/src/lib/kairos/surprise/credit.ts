import type { BeliefCiter } from '@/lib/data/belief-citers'
import type { SurpriseEventInput, SurpriseEventKind } from '@/lib/data/validators/kairos-surprise'
import { SURPRISE_MAX_OPENED, SURPRISE_MAX_REFS } from '@/lib/data/validators/kairos-surprise'
import { surpriseCreditMode, type SurpriseMode } from './flag'
import { applySurpriseEvent } from './ledger'
import { openMemories } from './marks'

// Backward credit (spec_surprise lane 2). A settled prediction or a closed
// promise reaches one hop further than its own basis: held beliefs that CITE
// a non-belief basis id (a reflection, a goal, a seed) share in the outcome.
// Hop 1 (the basis ids themselves) stays with predictions/verdict.ts
// feedBackSettlement; this walker never credits a basis id. Idempotent per
// settlement through the ledger's `seen` key. Never throws.
//
// KAIROS_SURPRISE_CREDIT: off → nothing (no read, no write); observe → the
// ledger event only (would-credit counts, nothing opened, no reaction); on →
// event + reactOutcome per credited belief + open the blamed beliefs.

export const CREDIT_MIN_SHARE = 0.25
export const CREDIT_MAX_PER_BASIS = 3
export const CREDIT_MAX_PER_SETTLEMENT = 10
// Same bar as hop 1 (OUTCOME_FEEDBACK_MIN_PROBABILITY): no indirect credit
// for a call the direct basis is not credited for.
export const CREDIT_MIN_PROBABILITY = 0.7
// A wrong call at p ≥ .6 is a surprise: it opens the beliefs behind it.
export const BLAME_MIN_PROBABILITY = 0.6
export const PROMISE_SURPRISE = { kept: 0.2, lapsed: 0.6, dropped: 0.4 } as const

export type CreditOutcome = 'right' | 'wrong' | 'kept' | 'lapsed' | 'dropped'
export type CreditDirection = 'positive' | 'negative'

export interface CreditBackwardInput {
  kind: 'prediction' | 'promise'
  id: string
  outcome: CreditOutcome
  s: number
  basisIds: readonly string[]
  dominionId: string | null
  label: string
  // Predictions only: the stated probability.
  probability?: number
  // Ids already credited directly (hop 1) — never credited again here.
  excludeIds?: readonly string[]
}

export interface CreditPolicy {
  event: SurpriseEventKind | null
  direction: CreditDirection | null
  open: boolean
}

const NONE: CreditPolicy = { event: null, direction: null, open: false }

export function creditPolicy(input: Pick<CreditBackwardInput, 'kind' | 'outcome' | 'probability'>): CreditPolicy {
  if (input.kind === 'prediction') {
    const p = input.probability ?? 0
    const credits = p >= CREDIT_MIN_PROBABILITY
    if (input.outcome === 'wrong') {
      const blame = p >= BLAME_MIN_PROBABILITY
      return { event: blame ? 'prediction_wrong' : null, direction: credits ? 'negative' : null, open: blame }
    }
    if (input.outcome === 'right') return credits ? { event: 'prediction_right', direction: 'positive', open: false } : NONE
    return NONE
  }
  switch (input.outcome) {
    case 'kept': return { event: 'promise_kept', direction: 'positive', open: false }
    case 'lapsed': return { event: 'promise_lapsed', direction: 'negative', open: true }
    case 'dropped': return { event: 'promise_dropped', direction: null, open: false }
    default: return NONE
  }
}

export interface CreditPlan {
  // Hop-2 beliefs that share in the outcome (direction from the policy).
  credit: string[]
  // Beliefs opened for update (basis beliefs + hop-2 citers) when policy.open.
  blamed: string[]
  // Basis ids that are not beliefs (the hop-2 anchors).
  anchors: string[]
}

const uniq = (xs: readonly string[]) => [...new Set(xs)]
const share = (c: BeliefCiter) => 1 / Math.max(1, uniq(c.provenance).length)

// Pure: which citers share in the outcome. Per anchor ≤3 citers with share
// 1/|provenance| ≥ .25 in the same Dominion (any when the outcome has none),
// highest share first; ≤10 per settlement; each belief once; never a basis or
// an already-credited id.
export function planBackwardCredit(
  input: Pick<CreditBackwardInput, 'basisIds' | 'dominionId' | 'excludeIds'>,
  policy: CreditPolicy,
  beliefBasisIds: ReadonlySet<string>,
  citers: readonly BeliefCiter[],
): CreditPlan {
  const basis = uniq(input.basisIds)
  const anchors = basis.filter((id) => !beliefBasisIds.has(id))
  const excluded = new Set([...basis, ...(input.excludeIds ?? [])])
  const picked: string[] = []
  const taken = new Set<string>()
  for (const anchor of anchors) {
    const room = Math.min(CREDIT_MAX_PER_BASIS, CREDIT_MAX_PER_SETTLEMENT - picked.length)
    if (room <= 0) break
    const eligible = citers
      .filter((c) => c.provenance.includes(anchor)
        && !excluded.has(c.id)
        && !taken.has(c.id)
        && share(c) >= CREDIT_MIN_SHARE
        && (input.dominionId === null || c.dominionId === input.dominionId))
      .sort((a, b) => share(b) - share(a) || a.id.localeCompare(b.id))
      .slice(0, room)
    for (const c of eligible) { picked.push(c.id); taken.add(c.id) }
  }
  const directBeliefs = basis.filter((id) => beliefBasisIds.has(id))
  return {
    credit: policy.direction ? picked : [],
    blamed: policy.open ? uniq([...directBeliefs, ...picked]).slice(0, SURPRISE_MAX_OPENED) : [],
    anchors,
  }
}

export interface CreditBackwardResult {
  mode: Exclude<SurpriseMode, 'off'>
  created: boolean
  event: SurpriseEventKind
  direction: CreditDirection | null
  credited: string[]
  opened: string[]
}

export const creditKey = (kind: CreditBackwardInput['kind'], id: string) => `credit:${kind}:${id}`

export async function creditBackward(
  userId: string,
  input: CreditBackwardInput,
  opts: { now?: Date } = {},
): Promise<CreditBackwardResult | null> {
  const mode = surpriseCreditMode()
  if (mode === 'off') return null
  const policy = creditPolicy(input)
  if (!policy.event) return null
  const event = policy.event
  const now = opts.now ?? new Date()
  const key = creditKey(input.kind, input.id)
  const skipped: CreditBackwardResult = { mode, created: false, event, direction: policy.direction, credited: [], opened: [] }
  try {
    const { readKairosSurprise, mutateKairosSurprise } = await import('@/lib/data/kairos-surprise')
    if ((await readKairosSurprise(userId)).seen.includes(key)) return skipped

    let plan: CreditPlan = { credit: [], blamed: [], anchors: uniq(input.basisIds) }
    if ((policy.direction || policy.open) && input.basisIds.length > 0) {
      const { listBeliefCiters, listHeldBeliefIdsAmong } = await import('@/lib/data/belief-citers')
      const beliefIds = new Set(await listHeldBeliefIdsAmong(userId, input.basisIds))
      const anchors = uniq(input.basisIds).filter((id) => !beliefIds.has(id))
      const citers = anchors.length > 0 ? await listBeliefCiters(userId, anchors) : []
      plan = planBackwardCredit(input, policy, beliefIds, citers)
    }

    const live = mode === 'on'
    const n = plan.credit.length
    const record: SurpriseEventInput = {
      key,
      kind: event,
      s: input.s,
      at: now.toISOString(),
      dominionId: input.dominionId,
      refs: {
        ...(input.kind === 'prediction' ? { predictionId: input.id } : { promiseId: input.id }),
        beliefIds: uniq([...plan.blamed, ...plan.credit]).slice(0, SURPRISE_MAX_REFS),
        memoryIds: plan.anchors.slice(0, SURPRISE_MAX_REFS),
      },
      opened: live ? plan.blamed : [],
      credited: { pos: policy.direction === 'positive' ? n : 0, neg: policy.direction === 'negative' ? n : 0 },
    }
    const { created } = await mutateKairosSurprise(userId, (l) => applySurpriseEvent(l, record, now), now)
    if (!created) return skipped
    if (!live) {
      console.info('[kairos:surprise] credit observe', { kind: input.kind, event, wouldCredit: n, wouldOpen: plan.blamed.length })
      return { ...skipped, created: true, credited: plan.credit, opened: [] }
    }

    if (policy.direction && n > 0) {
      const { reactOutcome } = await import('@/lib/kairos/reactions')
      for (const id of plan.credit) await reactOutcome(userId, id, policy.direction, `${input.label} (cited basis)`)
    }
    const opened = plan.blamed.length > 0
      ? await openMemories(userId, plan.blamed, { kind: event, ref: input.id, s: input.s }, now)
      : []
    return { ...skipped, created: true, credited: plan.credit, opened }
  } catch (err) {
    console.error('[kairos:surprise] creditBackward failed:', err)
    return null
  }
}
