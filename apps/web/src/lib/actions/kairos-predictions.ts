'use server'

import { requireAuth } from '@/lib/actions/helpers'
import { listKairosPredictions, toKairosPredictionView } from '@/lib/data/kairos-predictions'
import { listKairosPredictionsSchema, ownerPredictionVerdictSchema } from '@/lib/data/validators/kairos-predictions'
import { scorePredictions } from '@/lib/kairos/predictions/score'
import { settleKairosPredictionByOwner } from '@/lib/kairos/predictions/verdict'

// Owner-only prediction controls for the web session. The Telegram operator
// chat is the other owner path; agents (MCP / REST bearer) have read-only access.

export async function listOwnKairosPredictions(scope?: 'open' | 'all') {
  const userId = await requireAuth()
  const input = listKairosPredictionsSchema.parse({ scope })
  const { predictions, closed } = await listKairosPredictions(userId, input)
  return { predictions: predictions.map(toKairosPredictionView), trackRecord: scorePredictions(closed, new Date()) }
}

export async function settleOwnKairosPrediction(predictionId: string, verdict: 'right' | 'wrong' | 'void') {
  const userId = await requireAuth()
  const input = ownerPredictionVerdictSchema.parse({ predictionId, verdict })
  return settleKairosPredictionByOwner(userId, input.predictionId, input.verdict, { via: 'session' })
}
