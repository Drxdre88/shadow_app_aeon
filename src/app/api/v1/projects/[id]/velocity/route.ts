import { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { getVelocityStats, type VelocityRange } from '@/lib/data/velocity'

type Params = { params: Promise<{ id: string }> }

const rangeSchema = z.enum(['7d', '30d', '90d', 'all']).optional()

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const url = new URL(request.url)
    const rangeResult = rangeSchema.safeParse(url.searchParams.get('range') || undefined)
    if (!rangeResult.success) return jsonError('Invalid range value', 400)

    const range: VelocityRange = rangeResult.data ?? '30d'
    const data = await getVelocityStats(id, range)
    return jsonData(data)
  }),
  API_READ_LIMIT
)
