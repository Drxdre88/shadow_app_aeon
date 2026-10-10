import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listEntities } from '@/lib/data/entities/queries'
import { listEntitiesSchema } from '@/lib/data/validators/entities'

// Mirrors the list_entities MCP tool through the same validator + data fn
// (entities-parity.test.ts). Read-only; owner-only.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = listEntitiesSchema.safeParse({
      kind: q.get('kind') ?? undefined,
      q: q.get('q') ?? undefined,
      limit: q.get('limit') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const list = await listEntities(result.id, parsed.data)
    return jsonData({ count: list.length, entities: list })
  }),
  API_READ_LIMIT
)
