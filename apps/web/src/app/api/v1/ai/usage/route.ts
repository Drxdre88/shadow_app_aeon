import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listAiUsageDaily, sumAiSpendSince, totalsByDay } from '@/lib/data/ai-usage'
import { dailySpendCapUsd, utcDayStart } from '@/lib/ai/spend'

// Auxiliary owner-only read of paid-key AI spend; outside MCP/REST parity.

const DAY_MS = 86_400_000

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
})

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    if (result.role !== 'admin') return jsonError('AI features restricted to administrators', 403)
    const denied = vorathGuard(result)
    if (denied) return denied

    const parsed = querySchema.safeParse({ days: request.nextUrl.searchParams.get('days') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const today = utcDayStart(Date.now())
    const since = new Date(today.getTime() - (parsed.data.days - 1) * DAY_MS)
    const [rows, spentTodayUsd] = await Promise.all([
      listAiUsageDaily(result.id, since),
      sumAiSpendSince(result.id, today),
    ])
    return jsonData({
      days: parsed.data.days,
      since: since.toISOString(),
      capUsd: dailySpendCapUsd(),
      spentTodayUsd,
      totals: totalsByDay(rows),
      rows,
    })
  }),
  API_READ_LIMIT,
)
