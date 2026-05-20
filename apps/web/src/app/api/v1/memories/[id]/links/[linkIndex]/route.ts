import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { removeLink } from '@/lib/data/memories'

type Params = { params: Promise<{ id: string; linkIndex: string }> }

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, linkIndex } = await (ctx as Params).params

    const idx = Number(linkIndex)
    if (!Number.isInteger(idx) || idx < 0) return jsonError('Invalid link index', 400)

    const updated = await removeLink(id, result.id, idx)
    if (!updated) return jsonError('Memory or link not found', 404)
    return jsonData({ id: updated.id, linksCount: (updated.links as unknown[]).length })
  }),
  API_WRITE_LIMIT
)
