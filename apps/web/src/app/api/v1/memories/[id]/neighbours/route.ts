import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById, getNeighbours } from '@/lib/data/memories'
import { getNeighboursSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const url = request.nextUrl
    const params: Record<string, unknown> = {
      hops: Number(url.searchParams.get('hops') ?? 1),
      limit: Number(url.searchParams.get('limit') ?? 20),
    }
    const includeReverse = url.searchParams.get('includeReverse')
    if (includeReverse !== null) params.includeReverse = includeReverse !== 'false'

    const parsed = getNeighboursSchema.safeParse(params)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const memory = await findMemoryById(id, result.id)
    if (!memory) return jsonError('Memory not found', 404)

    const neighbours = await getNeighbours(id, result.id, parsed.data)
    return jsonData({ memory, neighbours })
  }),
  API_READ_LIMIT
)
