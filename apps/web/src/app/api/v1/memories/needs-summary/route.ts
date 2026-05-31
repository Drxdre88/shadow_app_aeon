import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listMemoriesNeedingSummary } from '@/lib/data/memories'

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const url = request.nextUrl
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)))
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0))
    const realmId = url.searchParams.get('realmId') ?? undefined
    const projectId = url.searchParams.get('projectId') ?? undefined
    const types = url.searchParams.getAll('type')
    const missingRaw = url.searchParams.get('missing') ?? 'execSummary'
    const missing: 'execSummary' | 'aiTitle' | 'either' =
      missingRaw === 'aiTitle' || missingRaw === 'either' ? missingRaw : 'execSummary'
    const oldestFirst = url.searchParams.get('oldestFirst') !== 'false'

    const rows = await listMemoriesNeedingSummary(result.id, {
      limit,
      offset,
      realmId,
      projectId,
      type: types.length === 0 ? undefined : types.length === 1 ? types[0] : types,
      missing,
      oldestFirst,
    })

    return jsonData({ count: rows.length, memories: rows })
  }),
  API_READ_LIMIT
)
