import { z } from 'zod'
import { mutateKairosPredictions } from '@/lib/data/kairos-predictions'
import {
  predictionVerdictSchema,
  type KairosPrediction,
  type PredictionVerdict,
} from '@/lib/data/validators/kairos-predictions'
import { reactOutcome } from '@/lib/kairos/reactions'
import { settleInState } from './rules'

// The owner's verdict on a prediction (web session or the operator Telegram
// chat) — the only way an owner_verdict / needs_verdict prediction settles
// right or wrong. No agent, MCP tool, REST bearer path or thinking handler may
// import this module (predictions import-guard test).

export const OUTCOME_FEEDBACK_MIN_PROBABILITY = 0.7

export interface PredictionOwner { via: 'session' | 'telegram' }

const ownerSchema = z.object({ via: z.enum(['session', 'telegram']) }).strict()

export type SettlePredictionResult =
  | { ok: true; prediction: KairosPrediction }
  | { ok: false; reason: 'not_found' | 'already_settled' | 'forbidden' | 'invalid_verdict' }

// Second slice of spec B: a confident (p >= 0.7) call settled by a check or
// the owner feeds back into the beliefs it cited — right → positive outcome,
// wrong → negative (×0.8 standing via OutcomeScorer). Best-effort: reactOutcome
// never throws, and a settlement never waits on it to stand.
export async function feedBackSettlement(userId: string, prediction: KairosPrediction): Promise<number> {
  if (prediction.status !== 'right' && prediction.status !== 'wrong') return 0
  const by = prediction.settledBy?.kind
  if (by !== 'check' && by !== 'owner') return 0
  if (prediction.probability < OUTCOME_FEEDBACK_MIN_PROBABILITY) return 0
  const kind = prediction.status === 'right' ? 'positive' : 'negative'
  for (const memoryId of prediction.basisIds) {
    await reactOutcome(userId, memoryId, kind, `prediction R${prediction.seq} ${prediction.status}`)
  }
  return prediction.basisIds.length
}

export async function settleKairosPredictionByOwner(
  userId: string,
  predictionId: string,
  verdict: PredictionVerdict,
  owner: PredictionOwner,
  now: Date = new Date(),
): Promise<SettlePredictionResult> {
  const by = ownerSchema.safeParse(owner)
  if (!by.success) return { ok: false, reason: 'forbidden' }
  const v = predictionVerdictSchema.safeParse(verdict)
  if (!v.success) return { ok: false, reason: 'invalid_verdict' }

  const res = await mutateKairosPredictions<SettlePredictionResult>(userId, (state) => {
    const next = settleInState(state, predictionId, v.data, { kind: 'owner', via: by.data.via }, now)
    if (!next) {
      const closed = state.closed.some((p) => p.id === predictionId)
      return { state: null, result: { ok: false, reason: closed ? 'already_settled' : 'not_found' } }
    }
    return { state: next.state, result: { ok: true, prediction: next.prediction } }
  })
  if (res.ok) await feedBackSettlement(userId, res.prediction)
  return res
}
