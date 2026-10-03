import { z } from 'zod'
import { promiseDateSchema } from './kairos-promises'

// Kairos's track record (spec B). Dated, probability-weighted predictions
// stored as the server-owned `kairosPredictions` key in
// user_preferences.preferences. Kairos never settles one: only a user
// activity event / card-state rule, the owner's verdict, or the expiry rules.
// The list schema is shared by the list_kairos_predictions MCP tool and
// GET /api/v1/kairos/predictions.

export const MAX_OPEN_PREDICTIONS = 20
export const MAX_CLOSED_PREDICTIONS = 150
export const MAX_PREDICTIONS_PER_DAY = 5
export const MAX_PREDICTIONS_PER_SOURCE = { weekly_review: 3, reflect: 1 } as const
export const PREDICTION_CLAIM_MIN_CHARS = 20
export const PREDICTION_CLAIM_MAX_CHARS = 200
export const PREDICTION_MIN_PROBABILITY = 0.55
export const PREDICTION_MAX_PROBABILITY = 0.95
export const MAX_PREDICTION_BASIS = 5

export const predictionTopicSchema = z.enum(['delivery', 'scope', 'risk', 'people', 'other'])

export const predictionCheckSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('card_by'),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    expect: z.enum(['done', 'not_done']),
  }).strict(),
  z.object({ kind: z.literal('owner_verdict') }).strict(),
])

export const predictionSourceSchema = z.object({
  kind: z.enum(['weekly_review', 'reflect']),
  jobId: z.string().min(1).max(100),
  isoWeek: z.string().min(1).max(20).optional(),
}).strict()

export const predictionSettledBySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('check'),
    activityEventId: z.string().uuid().nullable(),
    rule: z.enum(['user_done_before_due', 'not_done_by_due']),
  }).strict(),
  z.object({ kind: z.literal('owner'), via: z.enum(['session', 'telegram']) }).strict(),
  z.object({ kind: z.literal('rule'), reason: z.enum(['card_gone', 'no_verdict_7d']) }).strict(),
])

// open / needs_verdict live in `open`; the rest in `closed`.
export const predictionStatusSchema = z.enum(['open', 'needs_verdict', 'right', 'wrong', 'void', 'unresolved'])

export const kairosPredictionSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  claim: z.string().min(1).max(PREDICTION_CLAIM_MAX_CHARS),
  probability: z.number().min(PREDICTION_MIN_PROBABILITY).max(PREDICTION_MAX_PROBABILITY),
  dueDate: promiseDateSchema,
  topic: predictionTopicSchema,
  dominionId: z.string().min(1).max(100).nullable(),
  basisIds: z.array(z.string().min(1).max(100)).max(MAX_PREDICTION_BASIS),
  check: predictionCheckSchema,
  source: predictionSourceSchema,
  createdAt: z.string(),
  status: predictionStatusSchema,
  settledAt: z.string().optional(),
  settledBy: predictionSettledBySchema.optional(),
  agentEvidenceSeenAt: z.string().optional(),
}).strict()

export const kairosPredictionsStateSchema = z.object({
  v: z.literal(1),
  nextSeq: z.number().int().positive(),
  open: z.array(kairosPredictionSchema).max(MAX_OPEN_PREDICTIONS),
  closed: z.array(kairosPredictionSchema).max(MAX_CLOSED_PREDICTIONS),
}).strict()

export type PredictionTopic = z.infer<typeof predictionTopicSchema>
export type PredictionCheck = z.infer<typeof predictionCheckSchema>
export type PredictionSource = z.infer<typeof predictionSourceSchema>
export type PredictionSettledBy = z.infer<typeof predictionSettledBySchema>
export type PredictionStatus = z.infer<typeof predictionStatusSchema>
export type KairosPrediction = z.infer<typeof kairosPredictionSchema>
export type KairosPredictionsState = z.infer<typeof kairosPredictionsStateSchema>

// One prediction as Kairos proposes it. Strict: id, seq, status, check and
// source are server-decided. `dominion` is a Dominion name or id; basisIds are
// grounded to the job's fed memory ids (unknown ids are dropped).
export const predictionProposalSchema = z.object({
  claim: z.string().trim().min(PREDICTION_CLAIM_MIN_CHARS).max(PREDICTION_CLAIM_MAX_CHARS),
  probability: z.number().finite(),
  dueDate: promiseDateSchema,
  topic: predictionTopicSchema.default('other'),
  dominion: z.string().trim().max(120).optional(),
  basisIds: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  taskId: z.string().uuid().optional(),
  expect: z.enum(['done', 'not_done']).optional(),
}).strict()

export type PredictionProposal = z.infer<typeof predictionProposalSchema>

// Lenient shape the weekly review accepts per item: a malformed prediction is
// dropped, never the review. createKairosPredictions re-validates strictly.
export const reviewPredictionSchema = z.object({
  claim: z.string().max(1000),
  probability: z.union([z.number(), z.string().max(10)]),
  dueDate: z.string().max(40),
  topic: z.string().max(40).nullable().optional(),
  dominion: z.string().max(120).nullable().optional(),
  basisIds: z.array(z.string().max(100)).max(12).nullable().optional(),
  taskId: z.string().max(100).nullable().optional(),
  expect: z.string().max(20).nullable().optional(),
})

export type ReviewPredictionProposal = z.infer<typeof reviewPredictionSchema>

export const listKairosPredictionsSchema = z.object({
  scope: z.enum(['open', 'all']).default('open'),
})

export type ListKairosPredictionsInput = z.infer<typeof listKairosPredictionsSchema>

// Owner-only (server actions under requireAuth, Telegram operator chat).
export const predictionVerdictSchema = z.enum(['right', 'wrong', 'void'])
export type PredictionVerdict = z.infer<typeof predictionVerdictSchema>
export const ownerPredictionVerdictSchema = z.object({
  predictionId: z.string().uuid(),
  verdict: predictionVerdictSchema,
})
