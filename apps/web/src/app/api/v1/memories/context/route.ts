import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { db } from '@/lib/db'
import { groupMembers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { prepareContext } from '@/lib/data/memories'
import { prepareContextSchema } from '@/lib/data/validators'
import { isEvalRead, noteAgentReads, relevantSourceIds } from '@/lib/kairos/agent-reads'

// Brain Phase 4 — GET /api/v1/memories/context
// Returns a budget-packed markdown context bundle assembled from the user's
// memory vault. Mirrors the prepare_context MCP tool through the same
// validator + data fn (parity test enforces this).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const url = request.nextUrl
    const params: Record<string, unknown> = {
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
    }
    const budgetTokens = url.searchParams.get('budgetTokens')
    if (budgetTokens) params.budgetTokens = Number(budgetTokens)
    const realmId = url.searchParams.get('realmId')
    if (realmId) params.realmId = realmId
    const dominionId = url.searchParams.get('dominionId')
    if (dominionId) params.dominionId = dominionId
    const hops = url.searchParams.get('hops')
    if (hops !== null) params.hops = Number(hops) as 0 | 1
    const maxSources = url.searchParams.get('maxSources')
    if (maxSources) params.maxSources = Number(maxSources)
    if (url.searchParams.get('includePinned') === 'false') params.includePinned = false
    if (url.searchParams.get('includeToday') === 'false') params.includeToday = false
    if (url.searchParams.get('includeMachine') === 'true') params.includeMachine = true
    const expand = url.searchParams.get('expand')
    if (expand === 'true') params.expand = true
    else if (expand === 'false') params.expand = false
    const entity = url.searchParams.get('entity')
    if (entity === 'true') params.entity = true
    else if (entity === 'false') params.entity = false

    const types = url.searchParams.getAll('type')
    if (types.length === 1) params.type = types[0]
    else if (types.length > 1) params.type = types

    const parsed = prepareContextSchema.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    // Realm-scope guard: caller must be a member of the realm if supplied.
    if (parsed.data.realmId) {
      const [m] = await db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, parsed.data.realmId), eq(groupMembers.userId, result.id)))
        .limit(1)
      if (!m) return jsonError('Realm not accessible', 403)
    }

    const data = await prepareContext(result.id, parsed.data)
    if (!isEvalRead(request.headers)) noteAgentReads(result.id, relevantSourceIds(data.sources), 'rest:prepare_context')
    return jsonData(data)
  }),
  API_READ_LIMIT
)
