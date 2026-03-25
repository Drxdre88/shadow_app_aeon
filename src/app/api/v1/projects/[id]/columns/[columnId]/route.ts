import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { verifyProjectOwnership } from '@/lib/data/projects'
import { updateColumn, deleteColumn } from '@/lib/data/columns'
import { updateColumnSchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string; columnId: string }> }

export const PUT = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, columnId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const parsed = updateColumnSchema.safeParse(body)
  if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

  const column = await updateColumn(columnId, id, parsed.data)
  if (!column) return jsonError('Column not found', 404)
  return jsonData(column)
})

export const DELETE = apiHandler(async (request: NextRequest, ctx: unknown) => {
  const result = await authenticateRequest(request)
  if (!isApiUser(result)) return result
  const { id, columnId } = await (ctx as Params).params

  if (!await verifyProjectOwnership(id, result.id)) return jsonError('Project not found', 404)

  const deleted = await deleteColumn(columnId, id)
  if (!deleted) return jsonError('Column not found', 404)
  return jsonData({ deleted: true })
})
