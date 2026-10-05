import { listKairosPredictions, toKairosPredictionView } from '@/lib/data/kairos-predictions'
import { listKairosPredictionsSchema } from '@/lib/data/validators/kairos-predictions'
import { scorePredictions } from '@/lib/kairos/predictions/score'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos predictions (track record) — READ ONLY. Kairos makes predictions
// only through the server (weekly review, reflect); only the owner's board
// activity, card-state rules or the owner's verdict settle them. No agent can
// settle one. Mirrors GET /api/v1/kairos/predictions.
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosPredictionTools: RegisterFn = (server) => {
  server.tool(
    'list_kairos_predictions',
    'List Vorath\'s dated predictions by R-number (R3 …): claim, stated probability, due date (London), status and how each is checked, plus his 90-day track record (hit rate, Brier score, over-confidence; shown once 5 are settled). scope "open" (default) or "all" to include settled history. Read-only — only the owner\'s board activity or verdict settles a prediction.',
    { scope: listKairosPredictionsSchema.shape.scope.describe('"open" (default) or "all"') },
    { title: 'List Vorath Predictions', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listKairosPredictionsSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const { predictions, closed } = await listKairosPredictions(uid, parsed.data)
      return ok({ count: predictions.length, predictions: predictions.map(toKairosPredictionView), trackRecord: scorePredictions(closed, new Date()) })
    }
  )
}
