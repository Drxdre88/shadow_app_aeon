import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { updateRow, deleteRow } from '@/lib/data/gantt'
import { updateRowSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; rowId: string }> }

export const PUT = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, rowId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateRowSchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const row = await updateRow(rowId, id, parsed.data)
    if (!row) return jsonError('Row not found', 404)
    return jsonData(row)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id, rowId } = await (ctx as Params).params

    if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

    const deleted = await deleteRow(rowId, id)
    if (!deleted) return jsonError('Row not found', 404)
    return jsonData({ deleted: true })
  }),
  API_WRITE_LIMIT
)
