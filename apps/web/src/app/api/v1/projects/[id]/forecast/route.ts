import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readCardForecasts } from '@/lib/data/card-forecast'
import { getCardForecastSchema } from '@/lib/data/validators/card-forecast'

// Mirrors the get_card_forecast MCP tool through the same validator + data fn (card-forecast-parity.test.ts).

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const parsed = getCardForecastSchema.safeParse({ projectId: id, taskId: request.nextUrl.searchParams.get('taskId') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const view = await readCardForecasts(parsed.data.projectId, result.id, { taskId: parsed.data.taskId })
    if (!view) return jsonError('Project not found', 404)
    return jsonData(view)
  }),
  API_READ_LIMIT
)
