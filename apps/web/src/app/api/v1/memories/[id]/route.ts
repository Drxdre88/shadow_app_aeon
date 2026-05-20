import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT, API_WRITE_LIMIT } from '@/lib/api/rateLimit'
import { findMemoryById, updateMemory as _updateMemory, deleteMemory as _deleteMemory } from '@/lib/data/memories'
import { updateMemorySchema } from '@/lib/data/validators'

type Params = { params: Promise<{ id: string }> }

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const memory = await findMemoryById(id, result.id)
    if (!memory) return jsonError('Memory not found', 404)
    return jsonData(memory)
  }),
  API_READ_LIMIT
)

export const PATCH = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    const parsed = updateMemorySchema.safeParse(body)
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const memory = await _updateMemory(id, result.id, parsed.data)
    if (!memory) return jsonError('Memory not found', 404)
    return jsonData(memory)
  }),
  API_WRITE_LIMIT
)

export const DELETE = withRateLimit(
  apiHandler(async (request: NextRequest, ctx: unknown) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const { id } = await (ctx as Params).params

    const ok = await _deleteMemory(id, result.id)
    if (!ok) return jsonError('Memory not found', 404)
    return jsonData({ deleted: true })
  }),
  API_WRITE_LIMIT
)
