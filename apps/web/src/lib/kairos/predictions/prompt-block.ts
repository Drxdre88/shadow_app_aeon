import { z } from 'zod'
import {
  MAX_PREDICTIONS_PER_SOURCE,
  PREDICTION_CLAIM_MAX_CHARS,
  PREDICTION_CLAIM_MIN_CHARS,
  reviewPredictionSchema,
  type KairosPredictionsState,
  type ReviewPredictionProposal,
} from '@/lib/data/validators/kairos-predictions'
import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { dueWindow } from '@/lib/kairos/promises/rules'
import { scorePredictions, TRACK_RECORD_MIN_N, type TrackRecordScore } from './score'

// Prompt-side track record: the confidence note fed to the weekly review (and
// reflect, wave 2), the deterministic line the review renders in code, and
// the review's predictions spec + lenient parse. Pure: no DB import.

const pct = (x: number) => `${Math.round(x * 100)}%`
const signedPts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} pts`

function clip(s: string, max: number): string {
  const flat = neutraliseFences(s.replace(/\s+/g, ' ').trim())
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

// Over/under-confidence beyond this many points earns an explicit instruction.
const CALIBRATION_NOTE_THRESHOLD = 0.05

export function renderTrackRecordBlock(score: TrackRecordScore): string {
  const head = `TRACK RECORD — your settled predictions over the last ${score.windowDays} days (settled only by the operator's board activity or verdict, never by you):`
  const o = score.overall
  if (!o) return [head, `- ${score.n} settled so far — too few (under ${TRACK_RECORD_MIN_N}) to judge your calibration yet.`].join('\n')
  const lines = [head, `- ${o.right} of ${o.n} right (${pct(o.hitRate)}) at a mean stated probability of ${pct(o.meanProbability)} · Brier ${o.brier.toFixed(2)} · over-confidence ${signedPts(o.overconfidence)}`]
  for (const t of score.byTopic) lines.push(`- topic ${t.topic}: ${t.right}/${t.n} right, over-confidence ${signedPts(t.overconfidence)}`)
  if (o.overconfidence > CALIBRATION_NOTE_THRESHOLD) lines.push('- You have been over-confident: state lower probabilities unless the evidence is unusually strong.')
  else if (o.overconfidence < -CALIBRATION_NOTE_THRESHOLD) lines.push('- You have been under-confident: you may state higher probabilities when the evidence supports it.')
  return lines.join('\n')
}

// One plain line built in code (so the model can't spin it); null until n >= 5.
export function renderTrackRecordLine(score: TrackRecordScore): string | null {
  const o = score.overall
  if (!o) return null
  return `Track record (${score.windowDays} days): ${o.right} of ${o.n} predictions right (${pct(o.hitRate)}) · Brier ${o.brier.toFixed(2)} · over-confidence ${signedPts(o.overconfidence)}`
}

export interface ReviewPredictionContext {
  earliest: string
  latest: string
  open: ReadonlyArray<{ seq: number; claim: string; dueDate: string; probability: number }>
  trackRecordBlock: string
  trackRecordLine: string | null
}

// Pure (no DB) so the prompt modules stay importable without a database.
export function buildReviewPredictionContext(state: KairosPredictionsState, now: Date): ReviewPredictionContext {
  const score = scorePredictions(state.closed, now)
  return {
    ...dueWindow(now),
    open: state.open.map((p) => ({ seq: p.seq, claim: p.claim, dueDate: p.dueDate, probability: p.probability })),
    trackRecordBlock: renderTrackRecordBlock(score),
    trackRecordLine: renderTrackRecordLine(score),
  }
}

export function predictionPromptLines(ctx: ReviewPredictionContext): string[] {
  const max = MAX_PREDICTIONS_PER_SOURCE.weekly_review
  const out = [
    '',
    ctx.trackRecordBlock,
    '',
    `PREDICTIONS — you may add up to ${max} falsifiable predictions about the weeks ahead, each with your honest probability that it comes TRUE. No hedges ("might", "may", "could", "possibly").`,
    `Add them to the JSON as "predictions": [{ "claim": string (${PREDICTION_CLAIM_MIN_CHARS}–${PREDICTION_CLAIM_MAX_CHARS} characters), "probability": number 0.55–0.95 in 0.05 steps, "dueDate": "YYYY-MM-DD" between ${ctx.earliest} and ${ctx.latest}, "topic": "delivery" | "scope" | "risk" | "people" | "other", "dominion": string | null, "basisIds": string[] (ids in [brackets] above), "taskId": string | null, "expect": "done" | "not_done" }].`,
    'Use "taskId" + "expect" only for a claim about a board card being done (or still not done) by the due date; otherwise null. You never settle a prediction: the operator\'s board activity or verdict does. Use [] when nothing is worth predicting.',
    'Already open (do not repeat):',
  ]
  if (ctx.open.length === 0) out.push('- (none)')
  for (const p of ctx.open) out.push(`- R${p.seq} (${pct(p.probability)}) due ${p.dueDate}: ${clip(p.claim, 200)}`)
  return out
}

// Lenient per item: a malformed prediction list or item never costs the
// review. createKairosPredictions re-validates each one strictly.
export const lenientReviewPredictionsSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v.flatMap((item) => {
    const parsed = reviewPredictionSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  }).slice(0, MAX_PREDICTIONS_PER_SOURCE.weekly_review * 2) : undefined),
  z.array(reviewPredictionSchema).optional(),
)

export type { ReviewPredictionProposal }
