import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listTraceHistory } from '@/lib/data/recipes'
import { traceHistoryQuery } from '@/app/api/[transport]/tools/recipes'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3B — REST mirror of get_trace_history MCP tool.
// Shares the traceHistoryQuery validator and listTraceHistory data fn so
// MCP and REST surfaces never drift.
// ─────────────────────────────────────────────────────────────────────────

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const url = request.nextUrl
    const params: Record<string, unknown> = {}
    const dominionId = url.searchParams.get('dominionId')
    if (dominionId) params.dominionId = dominionId
    const recipe = url.searchParams.get('recipe')
    if (recipe) params.recipe = recipe
    const limit = url.searchParams.get('limit')
    if (limit) params.limit = Number(limit)

    const parsed = traceHistoryQuery.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const rows = await listTraceHistory(result.id, parsed.data)
    return jsonData({ count: rows.length, traces: rows })
  }),
  API_READ_LIMIT,
)
