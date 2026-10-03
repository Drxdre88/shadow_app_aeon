import { londonDate, londonInstant } from '@/lib/kairos/daily-message-prompt'
import { addDays, daysBetween } from '@/lib/kairos/promises/rules'
import {
  MAX_CLOSED_PREDICTIONS,
  PREDICTION_MAX_PROBABILITY,
  PREDICTION_MIN_PROBABILITY,
  type KairosPrediction,
  type KairosPredictionsState,
  type PredictionSettledBy,
} from '@/lib/data/validators/kairos-predictions'

// Pure prediction rules (no DB): the cut-off instant, hedge / probability
// guards, and the state transitions the data layer's locked mutation applies.

export const PREDICTION_VERDICT_EXPIRY_DAYS = 7

// Hedged claims can't be wrong, so they can't be scored.
const HEDGE_RE = /\b(might|may|could|possibly)\b/i

export function isHedgedClaim(claim: string): boolean {
  return HEDGE_RE.test(claim)
}

export function normaliseClaim(claim: string): string {
  return claim.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!]+$/, '')
}

// In range on the raw value, then snapped to the 0.05 grid.
export function snapProbability(p: number): number | null {
  if (!Number.isFinite(p) || p < PREDICTION_MIN_PROBABILITY - 1e-9 || p > PREDICTION_MAX_PROBABILITY + 1e-9) return null
  const snapped = Math.round(p * 20) / 20
  return Math.min(PREDICTION_MAX_PROBABILITY, Math.max(PREDICTION_MIN_PROBABILITY, snapped))
}

// The London end of the due date: 00:00 London on the next day.
export function predictionCutoff(dueDate: string): Date {
  return londonInstant(addDays(dueDate, 1), 0)
}

export function daysPastDue(p: Pick<KairosPrediction, 'dueDate'>, now: Date): number {
  return daysBetween(p.dueDate, londonDate(now))
}

export function isVerdictExpired(p: Pick<KairosPrediction, 'dueDate'>, now: Date): boolean {
  return daysPastDue(p, now) >= PREDICTION_VERDICT_EXPIRY_DAYS
}

export function createdOnLondonDay(state: KairosPredictionsState, now: Date): number {
  const today = londonDate(now)
  return [...state.open, ...state.closed].filter((p) => londonDate(new Date(p.createdAt)) === today).length
}

export type SettledStatus = 'right' | 'wrong' | 'void' | 'unresolved'

// Moves one unsettled prediction to closed (newest first, capped). null = not open.
export function settleInState(
  state: KairosPredictionsState,
  predictionId: string,
  status: SettledStatus,
  settledBy: PredictionSettledBy,
  now: Date,
): { state: KairosPredictionsState; prediction: KairosPrediction } | null {
  const target = state.open.find((p) => p.id === predictionId)
  if (!target) return null
  const prediction: KairosPrediction = { ...target, status, settledAt: now.toISOString(), settledBy }
  return {
    prediction,
    state: {
      ...state,
      open: state.open.filter((p) => p.id !== predictionId),
      closed: [prediction, ...state.closed].slice(0, MAX_CLOSED_PREDICTIONS),
    },
  }
}

export function replaceOpen(state: KairosPredictionsState, prediction: KairosPrediction): KairosPredictionsState {
  return { ...state, open: state.open.map((p) => (p.id === prediction.id ? prediction : p)) }
}
