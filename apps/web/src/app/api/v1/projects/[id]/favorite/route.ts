import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectAccess, toggleProjectFavorite } from '@/lib/data/projects'
import { setFavoriteSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectAccess(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = setFavoriteSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    await toggleProjectFavorite(result.id, id, parsed.data.favorite)
    return jsonData({ favorite: parsed.data.favorite })
  }),
  API_WRITE_LIMIT
)
