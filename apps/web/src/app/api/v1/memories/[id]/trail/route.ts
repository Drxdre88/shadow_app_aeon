import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { getBeliefTrail } from '@/lib/data/memories'
import { getBeliefTrailSchema } from '@/lib/data/validators'

// Mirrors the get_belief_trail MCP tool through the same validator + data fn
// (parity test enforces this). Supersession lineage read-path — oldest to
// newest, with confidence and validity window per node.

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const parsed = getBeliefTrailSchema.safeParse({ id })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const trail = await getBeliefTrail(parsed.data.id, result.id)
    if (!trail) return jsonError('Memory not found', 404)
    return jsonData({ trail })
  }),
  API_READ_LIMIT
)
