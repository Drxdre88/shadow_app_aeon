import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { updateLabel, deleteLabel } from '@/lib/data/labels'
import { updateLabelSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; labelId: string }> }

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, labelId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateLabelSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const label = await updateLabel(labelId, id, parsed.data)
    if (!label) return jsonError('Label not found', 404)
    return jsonData(label)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, labelId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const deleted = await deleteLabel(labelId, id)
    if (!deleted) return jsonError('Label not found', 404)
    return jsonData({ deleted: true })
  }),
  API_WRITE_LIMIT
)
