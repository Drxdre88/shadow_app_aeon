import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { reorderRows, verifyRowsOwnership } from '@/lib/data/gantt'
import { reorderRowsSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = reorderRowsSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const rowIds = parsed.data.updates.map((u) => u.id)
    if (!await verifyRowsOwnership(rowIds, id)) {
      return jsonError('One or more rows not found in this project', 404)
    }

    await reorderRows(id, parsed.data.updates)
    return jsonData({ reordered: true })
  }),
  API_WRITE_LIMIT
)
