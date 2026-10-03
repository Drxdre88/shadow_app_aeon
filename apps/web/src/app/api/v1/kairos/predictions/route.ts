import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listKairosPredictions, toKairosPredictionView } from '@/lib/data/kairos-predictions'
import { listKairosPredictionsSchema } from '@/lib/data/validators/kairos-predictions'
import { scorePredictions } from '@/lib/kairos/predictions/score'

// Mirrors the list_kairos_predictions MCP tool through the same validator +
// data fn. Read-only: no REST route can settle a prediction.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const scope = request.nextUrl.searchParams.get('scope') ?? undefined
    const parsed = listKairosPredictionsSchema.safeParse({ scope })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const { predictions, closed } = await listKairosPredictions(result.id, parsed.data)
    return jsonData({ count: predictions.length, predictions: predictions.map(toKairosPredictionView), trackRecord: scorePredictions(closed, new Date()) })
  }),
  API_READ_LIMIT
)
