import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { getEntity } from '@/lib/data/entities/queries'
import { getEntitySchema } from '@/lib/data/validators/entities'

// Mirrors the get_entity MCP tool through the same validator + data fn
// (entities-parity.test.ts). [id] is an entity UUID or a name / alias.

type Params = { params: Promise<{ id: string }> }

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied
    const { id } = await (ctx as Params).params

    const parsed = getEntitySchema.safeParse({
      id: safeDecode(id),
      mentions: request.nextUrl.searchParams.get('mentions') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const entity = await getEntity(result.id, parsed.data)
    if (!entity) return jsonError('Entity not found', 404)
    return jsonData(entity)
  }),
  API_READ_LIMIT
)
