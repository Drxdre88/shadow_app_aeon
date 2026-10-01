import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listBeliefs } from '@/lib/data/beliefs'
import { listBeliefsSchema } from '@/lib/data/validators/beliefs'

// Mirrors the list_beliefs MCP tool through the same validator + data fn
// (beliefs-parity.test.ts enforces this). Belief ledger, newest first.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const params = request.nextUrl.searchParams
    const parsed = listBeliefsSchema.safeParse({
      mind: params.get('mind') ?? undefined,
      domain: params.get('domain') ?? undefined,
      status: params.get('status') ?? undefined,
      limit: params.get('limit') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const beliefs = await listBeliefs(result.id, parsed.data)
    return jsonData({ count: beliefs.length, beliefs })
  }),
  API_READ_LIMIT
)
